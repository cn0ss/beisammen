import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { adjustCircleStats, assetStatsDelta } from './circleStats';
import {
  BILLING_FEATURE_IDS,
  type BillingOwner,
  requireCloudOwnerFeatureAccess,
  resolveCircleBillingOwner,
  resolveOwnerStorageCap,
  trackCloudOwnerUsage,
} from './lib/billing/quota';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { canPublish } from './lib/permissions';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';
import { createS3UploadTarget, deleteS3Object, verifyS3ObjectExists } from './lib/storage/s3';
import {
  buildS3ObjectKey,
  buildS3PreviewObjectKey,
  buildS3StorageReference,
  getCurrentInstanceStorage,
} from './lib/storage/shared';
import {
  assertUploadTargetWithinBetaLimits,
  assertValidDeclaredUploadSizes,
} from './lib/uploadLimits';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const uploadFunctionSurface = [
  'uploads.createTarget',
  'uploads.complete',
  'uploads.retry',
  'uploads.discard',
] as const;

interface S3PendingStorage {
  provider: 's3';
  objectKey: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  basePath?: string;
}

interface PreparedUploadContext {
  uploadId: Id<'uploads'>;
  providerKind: 's3';
  mimeType: string;
  fileName: string;
  kind: 'image' | 'video';
  shareBatchId: Id<'shareBatches'>;
  circleId: Id<'circles'>;
  declaredSizeBytes: number;
  declaredPreviewSizeBytes: number;
  pendingStorage: S3PendingStorage;
  previewPendingStorage?: S3PendingStorage;
}

interface AuthorizedCreateTargetContext {
  circleId: Id<'circles'>;
  shareBatchId: Id<'shareBatches'>;
  billingOwner: BillingOwner;
}

interface AuthorizedRetryContext {
  uploadId: Id<'uploads'>;
  circleId: Id<'circles'>;
  billingOwner: BillingOwner;
  declaredSizeBytes: number;
  declaredPreviewSizeBytes: number;
}

interface CompleteUploadContext {
  uploadId: Id<'uploads'>;
  providerKind: 's3';
  circleId: Id<'circles'>;
  billingOwner: BillingOwner;
  hasAsset: boolean;
  existingAssetSizeBytes: number;
  // Optional only for legacy rows created before size enforcement.
  declaredSizeBytes?: number;
  declaredPreviewSizeBytes?: number;
  pendingStorage: S3PendingStorage;
  previewPendingStorage?: S3PendingStorage;
}

async function refundCloudUsage(input: {
  ctx: ActionCtx;
  owner: BillingOwner;
  entityId: string;
  mediaUploads: number;
  storageBytes: number;
}) {
  const refunds: Array<{ featureId: string; value: number }> = [];

  if (input.mediaUploads > 0) {
    refunds.push({
      featureId: BILLING_FEATURE_IDS.mediaUploads,
      value: -input.mediaUploads,
    });
  }

  if (input.storageBytes > 0) {
    refunds.push({
      featureId: BILLING_FEATURE_IDS.storageBytes,
      value: -input.storageBytes,
    });
  }

  for (const usage of refunds) {
    try {
      await trackCloudOwnerUsage(input.ctx, {
        owner: input.owner,
        entityId: input.entityId,
        featureId: usage.featureId,
        value: usage.value,
      });
    } catch (error) {
      console.error('Failed to refund usage after upload failure.', error);
    }
  }
}

async function requireUploadCompletionAuthor(
  ctx: QueryCtx | MutationCtx,
  upload: Doc<'uploads'>,
  viewerId: Id<'users'>,
) {
  await requireCircleMembership(ctx, viewerId, upload.circleId);

  const shareBatch = await ctx.db.get(upload.shareBatchId);

  if (!shareBatch || shareBatch.circleId !== upload.circleId) {
    throw new Error('Share batch not found in the selected circle.');
  }

  if (shareBatch.authorId !== viewerId || upload.createdBy !== viewerId) {
    throw new Error('Only the draft author can complete uploads into this share batch.');
  }

  if (shareBatch.status !== 'draft') {
    throw new Error('Only draft uploads can be completed.');
  }

  return shareBatch;
}

async function authorizeCreateTargetRequest(
  ctx: QueryCtx | MutationCtx,
  args: {
    circleId: Id<'circles'>;
    shareBatchId: Id<'shareBatches'>;
    mimeType: string;
    kind: 'image' | 'video';
    fileName: string;
    sizeBytes: number;
    previewSizeBytes: number;
  },
): Promise<AuthorizedCreateTargetContext> {
  const viewer = await requireViewer(ctx);
  const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

  if (!canPublish(membership.role)) {
    throw new Error('Publishing is not allowed for this member role.');
  }

  const shareBatch = await ctx.db.get(args.shareBatchId);

  if (!shareBatch || shareBatch.circleId !== args.circleId) {
    throw new Error('Share batch not found in the selected circle.');
  }

  if (shareBatch.authorId !== viewer._id || shareBatch.status !== 'draft') {
    throw new Error('Only the draft author can upload into this share batch.');
  }

  assertValidDeclaredUploadSizes({
    sizeBytes: args.sizeBytes,
    previewSizeBytes: args.previewSizeBytes,
  });
  assertUploadTargetWithinBetaLimits({
    kind: args.kind,
    mimeType: args.mimeType,
    fileName: args.fileName,
  });

  return {
    circleId: args.circleId,
    shareBatchId: args.shareBatchId,
    billingOwner: await resolveCircleBillingOwner(ctx, args.circleId),
  };
}

async function authorizeRetryRequest(
  ctx: QueryCtx | MutationCtx,
  uploadId: Id<'uploads'>,
): Promise<AuthorizedRetryContext> {
  const viewer = await requireViewer(ctx);
  const upload = await ctx.db.get(uploadId);

  if (!upload) {
    throw new Error('Upload not found.');
  }

  const membership = await requireCircleMembership(ctx, viewer._id, upload.circleId);

  if (!canPublish(membership.role)) {
    throw new Error('Publishing is not allowed for this member role.');
  }

  const shareBatch = await ctx.db.get(upload.shareBatchId);

  if (!shareBatch || shareBatch.circleId !== upload.circleId) {
    throw new Error('Share batch not found in the selected circle.');
  }

  if (
    shareBatch.authorId !== viewer._id ||
    upload.createdBy !== viewer._id ||
    shareBatch.status !== 'draft'
  ) {
    throw new Error('Only the draft author can retry uploads into this share batch.');
  }

  if (upload.assetId || upload.status === 'uploaded') {
    throw new Error('Completed uploads cannot be retried.');
  }

  // The convex-files code path is gone; the last such in-flight rows can only
  // be discarded and re-created as S3 uploads.
  if (upload.providerKind !== 's3') {
    throw new Error('This upload cannot be retried. Remove it and add the file again.');
  }

  // Rows created before size enforcement carry no declared sizes, so no
  // exact-size PUT can be signed for them. They must be discarded and
  // re-created instead of retried.
  if (
    upload.declaredSizeBytes === undefined ||
    upload.declaredPreviewSizeBytes === undefined
  ) {
    throw new Error(
      'This upload cannot be retried. Remove it and add the file again.',
    );
  }

  return {
    uploadId: upload._id,
    circleId: upload.circleId,
    billingOwner: await resolveCircleBillingOwner(ctx, upload.circleId),
    declaredSizeBytes: upload.declaredSizeBytes,
    declaredPreviewSizeBytes: upload.declaredPreviewSizeBytes,
  };
}

export const authorizeCreateTarget = internalQuery({
  args: {
    circleId: v.id('circles'),
    shareBatchId: v.id('shareBatches'),
    mimeType: v.string(),
    kind: v.union(v.literal('image'), v.literal('video')),
    fileName: v.string(),
    sizeBytes: v.number(),
    previewSizeBytes: v.number(),
  },
  handler: async (ctx, args): Promise<AuthorizedCreateTargetContext> => {
    return await authorizeCreateTargetRequest(ctx, args);
  },
});

export const authorizeRetry = internalQuery({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args): Promise<AuthorizedRetryContext> => {
    return await authorizeRetryRequest(ctx, args.uploadId);
  },
});

export const prepareCreateTarget = internalMutation({
  args: {
    circleId: v.id('circles'),
    shareBatchId: v.id('shareBatches'),
    mimeType: v.string(),
    kind: v.union(v.literal('image'), v.literal('video')),
    fileName: v.string(),
    sizeBytes: v.number(),
    previewSizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await authorizeCreateTargetRequest(ctx, args);

    const storageMode = getCurrentInstanceStorage();
    const uploadId = await ctx.db.insert('uploads', {
      shareBatchId: args.shareBatchId,
      circleId: args.circleId,
      createdBy: viewer._id,
      providerKind: storageMode.providerKind,
      kind: args.kind,
      fileName: args.fileName.trim(),
      mimeType: args.mimeType.trim(),
      declaredSizeBytes: args.sizeBytes,
      declaredPreviewSizeBytes: args.previewSizeBytes,
      status: 'uploading',
      createdAt: Date.now(),
    });

    const objectKey = buildS3ObjectKey({
      circleId: args.circleId,
      shareBatchId: args.shareBatchId,
      mimeType: args.mimeType.trim(),
      kind: args.kind,
      fileName: args.fileName.trim(),
      uploadId,
    });
    const pendingStorage = buildS3StorageReference({
      objectKey,
    });
    const previewPendingStorage = buildS3StorageReference({
      objectKey: buildS3PreviewObjectKey(objectKey),
    });

    await ctx.db.patch(uploadId, {
      pendingStorage,
      previewPendingStorage,
    });

    return {
      uploadId,
      providerKind: storageMode.providerKind,
      mimeType: args.mimeType.trim(),
      fileName: args.fileName.trim(),
      kind: args.kind,
      shareBatchId: args.shareBatchId,
      circleId: args.circleId,
      declaredSizeBytes: args.sizeBytes,
      declaredPreviewSizeBytes: args.previewSizeBytes,
      pendingStorage,
      previewPendingStorage,
    };
  },
});

export const prepareRetry = internalMutation({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);

    if (!upload) {
      throw new Error('Upload not found.');
    }

    const retryContext = await authorizeRetryRequest(ctx, args.uploadId);

    if (!upload.pendingStorage || upload.pendingStorage.provider !== 's3') {
      throw new Error('S3 upload target could not be recreated.');
    }

    await ctx.db.patch(upload._id, {
      status: 'uploading',
      failureReason: undefined,
    });

    return {
      uploadId: upload._id,
      providerKind: 's3' as const,
      mimeType: upload.mimeType,
      fileName: upload.fileName,
      kind: upload.kind,
      shareBatchId: upload.shareBatchId,
      circleId: upload.circleId,
      declaredSizeBytes: retryContext.declaredSizeBytes,
      declaredPreviewSizeBytes: retryContext.declaredPreviewSizeBytes,
      pendingStorage: upload.pendingStorage,
      ...(upload.previewPendingStorage && upload.previewPendingStorage.provider === 's3'
        ? { previewPendingStorage: upload.previewPendingStorage }
        : {}),
    };
  },
});

export const createTarget = action({
  args: {
    circleId: v.id('circles'),
    shareBatchId: v.id('shareBatches'),
    mimeType: v.string(),
    kind: v.union(v.literal('image'), v.literal('video')),
    fileName: v.string(),
    sizeBytes: v.number(),
    previewSizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const billingContext: AuthorizedCreateTargetContext = await ctx.runQuery(
      internal.uploads.authorizeCreateTarget,
      args,
    );

    if (policy.isCloud) {
      // Only storage is limited. The declared sizes are enforced by signing
      // them into the presigned PUTs, so requiring headroom for the full
      // declared payload here is an honest pre-check.
      await requireCloudOwnerFeatureAccess(ctx, {
        owner: billingContext.billingOwner,
        entityId: billingContext.circleId,
        featureId: BILLING_FEATURE_IDS.storageBytes,
        requiredBalance: args.sizeBytes + args.previewSizeBytes,
      });
    }

    const prepared: PreparedUploadContext = await ctx.runMutation(
      internal.uploads.prepareCreateTarget,
      args,
    );

    if (!prepared.pendingStorage || prepared.pendingStorage.provider !== 's3') {
      throw new Error('S3 upload target could not be prepared.');
    }

    const target = await createS3UploadTarget({
      storage: prepared.pendingStorage,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.declaredSizeBytes,
    });
    const previewTarget =
      prepared.previewPendingStorage && prepared.previewPendingStorage.provider === 's3'
        ? await createS3UploadTarget({
            storage: prepared.previewPendingStorage,
            mimeType: 'image/jpeg',
            sizeBytes: prepared.declaredPreviewSizeBytes,
          })
        : null;

    return {
      uploadId: prepared.uploadId,
      target,
      ...(previewTarget ? { previewTarget } : {}),
    };
  },
});

export const retry = action({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const billingContext: AuthorizedRetryContext = await ctx.runQuery(
      internal.uploads.authorizeRetry,
      args,
    );

    if (policy.isCloud) {
      await requireCloudOwnerFeatureAccess(ctx, {
        owner: billingContext.billingOwner,
        entityId: billingContext.circleId,
        featureId: BILLING_FEATURE_IDS.storageBytes,
        requiredBalance:
          billingContext.declaredSizeBytes + billingContext.declaredPreviewSizeBytes,
      });
    }

    const prepared: PreparedUploadContext = await ctx.runMutation(
      internal.uploads.prepareRetry,
      args,
    );

    if (!prepared.pendingStorage || prepared.pendingStorage.provider !== 's3') {
      throw new Error('S3 upload target could not be recreated.');
    }

    // Retries reuse the declared sizes stored at target creation, so the
    // retried PUT is signed for exactly the same payload.
    const target = await createS3UploadTarget({
      storage: prepared.pendingStorage,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.declaredSizeBytes,
    });
    const previewTarget =
      prepared.previewPendingStorage && prepared.previewPendingStorage.provider === 's3'
        ? await createS3UploadTarget({
            storage: prepared.previewPendingStorage,
            mimeType: 'image/jpeg',
            sizeBytes: prepared.declaredPreviewSizeBytes,
          })
        : null;

    return {
      uploadId: prepared.uploadId,
      target,
      ...(previewTarget ? { previewTarget } : {}),
    };
  },
});

export const getCompleteContext = internalQuery({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload) {
      throw new Error('Upload not found.');
    }

    await requireUploadCompletionAuthor(ctx, upload, viewer._id);

    // The convex-files code path is gone; the last such in-flight rows can
    // only be discarded and re-created as S3 uploads.
    if (upload.providerKind !== 's3') {
      throw new Error(
        'Legacy uploads can no longer be completed. Remove the item and add the file again.',
      );
    }

    if (!upload.pendingStorage || upload.pendingStorage.provider !== 's3') {
      throw new Error('Completed upload is missing its S3 storage reference.');
    }

    const existingAsset = upload.assetId ? await ctx.db.get(upload.assetId) : null;
    const billingOwner = await resolveCircleBillingOwner(ctx, upload.circleId);

    return {
      uploadId: upload._id,
      providerKind: 's3' as const,
      circleId: upload.circleId,
      billingOwner,
      hasAsset: Boolean(upload.assetId),
      existingAssetSizeBytes: existingAsset?.sizeBytes ?? 0,
      declaredSizeBytes: upload.declaredSizeBytes,
      declaredPreviewSizeBytes: upload.declaredPreviewSizeBytes,
      pendingStorage: upload.pendingStorage,
      ...(upload.previewPendingStorage && upload.previewPendingStorage.provider === 's3'
        ? { previewPendingStorage: upload.previewPendingStorage }
        : {}),
    };
  },
});

export const markFailed = internalMutation({
  args: {
    uploadId: v.id('uploads'),
    failureReason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);

    if (!upload || upload.status === 'uploaded') {
      return null;
    }

    await ctx.db.patch(upload._id, {
      status: 'failed',
      failureReason: args.failureReason,
    });

    return null;
  },
});

export const assetEncryptionValidator = v.object({
  v: v.literal(1),
  circleEpoch: v.number(),
  wrappedFileKey: v.string(),
  encMetadata: v.optional(v.string()),
});

async function assertValidAssetEncryption(
  ctx: QueryCtx | MutationCtx,
  upload: Doc<'uploads'>,
  encryption: { circleEpoch: number; wrappedFileKey: string },
): Promise<void> {
  if (encryption.wrappedFileKey.trim().length === 0) {
    throw new Error('wrappedFileKey is required for encrypted uploads.');
  }

  const epochRow = await ctx.db
    .query('circleKeyEpochs')
    .withIndex('by_circle_and_epoch', (q) =>
      q.eq('circleId', upload.circleId).eq('epoch', encryption.circleEpoch),
    )
    .unique();

  if (!epochRow) {
    throw new Error('Encrypted upload references an unknown circle key epoch.');
  }
}

export const finalizeComplete = internalMutation({
  args: {
    uploadId: v.id('uploads'),
    previewObjectKey: v.optional(v.string()),
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
    encryption: v.optional(assetEncryptionValidator),
    location: v.optional(
      v.object({
        latitude: v.number(),
        longitude: v.number(),
        accuracyMeters: v.optional(v.number()),
        label: v.optional(v.string()),
        city: v.optional(v.string()),
        region: v.optional(v.string()),
        country: v.optional(v.string()),
        source: v.union(v.literal('embedded'), v.literal('device-fallback')),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload) {
      throw new Error('Upload not found.');
    }

    if (args.encryption) {
      // Private metadata belongs inside the encrypted envelope; storing it in
      // plaintext next to an encrypted asset would defeat the point.
      if (args.location) {
        throw new Error('Encrypted uploads must not include a plaintext location.');
      }

      await assertValidAssetEncryption(ctx, upload, args.encryption);
    }

    const shareBatch = await requireUploadCompletionAuthor(ctx, upload, viewer._id);
    assertUploadTargetWithinBetaLimits({
      kind: upload.kind,
      mimeType: upload.mimeType,
      fileName: args.fileName?.trim() || upload.fileName,
    });

    if (upload.providerKind !== 's3') {
      throw new Error(
        'Legacy uploads can no longer be completed. Remove the item and add the file again.',
      );
    }

    const storage =
      upload.pendingStorage && upload.pendingStorage.provider === 's3'
        ? upload.pendingStorage
        : null;
    const previewStorage =
      args.previewObjectKey &&
      upload.previewPendingStorage &&
      upload.previewPendingStorage.provider === 's3'
        ? upload.previewPendingStorage
        : null;

    if (!storage) {
      throw new Error('Completed upload is missing its storage reference.');
    }

    const now = Date.now();
    const nextAssetFields = {
      fileName: args.fileName?.trim() || upload.fileName,
      sizeBytes: args.sizeBytes,
      width: args.width,
      height: args.height,
      durationSeconds: args.durationSeconds,
      capturedAt: args.capturedAt,
      location: args.location,
      encryption: args.encryption,
    };

    if (upload.assetId) {
      const existingAsset = await ctx.db.get(upload.assetId);
      await ctx.db.patch(upload.assetId, {
        storage,
        ...nextAssetFields,
        ...(previewStorage ? { previewStorage } : {}),
      });
      await ctx.db.patch(upload.shareBatchId, {
        updatedAt: now,
      });
      await ctx.db.patch(upload._id, {
        storage,
        ...(previewStorage ? { previewStorage } : {}),
        status: 'uploaded',
        completedAt: now,
      });

      if (existingAsset) {
        await adjustCircleStats(ctx, upload.circleId, {
          totalSizeBytes: (nextAssetFields.sizeBytes ?? 0) - (existingAsset.sizeBytes ?? 0),
        });
      }

      return {
        assetId: upload.assetId,
      };
    }

    const assetId = await ctx.db.insert('assets', {
      shareBatchId: upload.shareBatchId,
      circleId: upload.circleId,
      kind: upload.kind,
      fileName: nextAssetFields.fileName,
      mimeType: upload.mimeType,
      sizeBytes: nextAssetFields.sizeBytes,
      storage,
      ...(previewStorage ? { previewStorage } : {}),
      createdAt: now,
      width: nextAssetFields.width,
      height: nextAssetFields.height,
      durationSeconds: nextAssetFields.durationSeconds,
      capturedAt: nextAssetFields.capturedAt,
      location: nextAssetFields.location,
      encryption: nextAssetFields.encryption,
    });

    await ctx.db.patch(upload._id, {
      assetId,
      storage,
      ...(previewStorage ? { previewStorage } : {}),
      status: 'uploaded',
      completedAt: now,
    });
    await ctx.db.patch(upload.shareBatchId, {
      assetCount: shareBatch.assetCount + 1,
      updatedAt: now,
    });
    await adjustCircleStats(ctx, upload.circleId, assetStatsDelta({
      kind: upload.kind,
      sizeBytes: nextAssetFields.sizeBytes,
    }, 1));

    return {
      assetId,
    };
  },
});

export const complete = action({
  args: {
    uploadId: v.id('uploads'),
    objectKey: v.optional(v.string()),
    previewObjectKey: v.optional(v.string()),
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
    encryption: v.optional(assetEncryptionValidator),
    location: v.optional(
      v.object({
        latitude: v.number(),
        longitude: v.number(),
        accuracyMeters: v.optional(v.number()),
        label: v.optional(v.string()),
        city: v.optional(v.string()),
        region: v.optional(v.string()),
        country: v.optional(v.string()),
        source: v.union(v.literal('embedded'), v.literal('device-fallback')),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ assetId: Id<'assets'> }> => {
    const completeContext: CompleteUploadContext = await ctx.runQuery(
      internal.uploads.getCompleteContext,
      {
        uploadId: args.uploadId,
      },
    );
    const pendingStorage = completeContext.pendingStorage;

    if (!pendingStorage || pendingStorage.provider !== 's3') {
      throw new Error('Completed upload is missing its S3 storage reference.');
    }

    if (args.objectKey && args.objectKey !== pendingStorage.objectKey) {
      throw new Error('Completed upload object key does not match the prepared target.');
    }

    const verifiedOriginal = await verifyS3ObjectExists({
      storage: pendingStorage,
    });

    // Belt and suspenders: the signed content-length already forces every
    // PUT to match its declaration, so a mismatch here should be impossible.
    // If it happens anyway, drop the uploaded objects and fail the upload
    // instead of charging or attaching an unexpected payload.
    const rejectSizeMismatch = async (failureReason: string): Promise<never> => {
      await deleteS3Object({ storage: pendingStorage });

      const previewStorage = completeContext.previewPendingStorage;

      if (previewStorage && previewStorage.provider === 's3') {
        await deleteS3Object({ storage: previewStorage });
      }

      await ctx.runMutation(internal.uploads.markFailed, {
        uploadId: args.uploadId,
        failureReason,
      });
      throw new Error(failureReason);
    };

    if (
      completeContext.declaredSizeBytes !== undefined &&
      verifiedOriginal.sizeBytes !== completeContext.declaredSizeBytes
    ) {
      await rejectSizeMismatch(
        'Uploaded file size does not match the declared upload size.',
      );
    }

    if (args.previewObjectKey) {
      const previewPendingStorage = completeContext.previewPendingStorage;

      if (!previewPendingStorage || previewPendingStorage.provider !== 's3') {
        throw new Error('Completed upload is missing its S3 preview storage reference.');
      }

      if (args.previewObjectKey !== previewPendingStorage.objectKey) {
        throw new Error('Completed preview object key does not match the prepared target.');
      }

      const verifiedPreview = await verifyS3ObjectExists({
        storage: previewPendingStorage,
      });

      if (
        completeContext.declaredPreviewSizeBytes !== undefined &&
        verifiedPreview.sizeBytes !== completeContext.declaredPreviewSizeBytes
      ) {
        await rejectSizeMismatch(
          'Uploaded preview size does not match the declared preview size.',
        );
      }
    }

    const policy = getDeploymentPolicyFromEnv();
    const mediaUploadsDelta = completeContext.hasAsset ? 0 : 1;
    // The server-observed S3 size is authoritative for billing and metadata.
    const completedSizeBytes = verifiedOriginal.sizeBytes;
    const storageBytesDelta = (completedSizeBytes ?? 0) - completeContext.existingAssetSizeBytes;
    const chargedUsage = {
      mediaUploads: 0,
      storageBytes: 0,
    };

    if (policy.isCloud) {
      try {
        if (mediaUploadsDelta > 0) {
          await trackCloudOwnerUsage(ctx, {
            owner: completeContext.billingOwner,
            entityId: completeContext.circleId,
            featureId: BILLING_FEATURE_IDS.mediaUploads,
            value: mediaUploadsDelta,
            properties: {
              uploadId: args.uploadId,
              circleId: completeContext.circleId,
            },
          });
          chargedUsage.mediaUploads = mediaUploadsDelta;
        }

        if (storageBytesDelta > 0) {
          // The cap is enforced atomically inside the usage mutation, closing
          // the race where parallel completions each passed the createTarget
          // pre-check while under quota.
          const storageCap = await resolveOwnerStorageCap(
            ctx,
            completeContext.billingOwner._id,
          );

          await trackCloudOwnerUsage(ctx, {
            owner: completeContext.billingOwner,
            entityId: completeContext.circleId,
            featureId: BILLING_FEATURE_IDS.storageBytes,
            value: storageBytesDelta,
            ...(storageCap !== null ? { maxStorageBytes: storageCap } : {}),
            properties: {
              uploadId: args.uploadId,
              circleId: completeContext.circleId,
            },
          });
          chargedUsage.storageBytes = storageBytesDelta;
        }
      } catch (error) {
        await refundCloudUsage({
          ctx,
          owner: completeContext.billingOwner,
          entityId: completeContext.circleId,
          ...chargedUsage,
        });
        throw error;
      }
    }

    let finalized: { assetId: Id<'assets'> };

    try {
      finalized = await ctx.runMutation(internal.uploads.finalizeComplete, {
        uploadId: args.uploadId,
        ...(args.previewObjectKey ? { previewObjectKey: args.previewObjectKey } : {}),
        ...(args.fileName !== undefined ? { fileName: args.fileName } : {}),
        sizeBytes: completedSizeBytes,
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.durationSeconds !== undefined ? { durationSeconds: args.durationSeconds } : {}),
        ...(args.capturedAt !== undefined ? { capturedAt: args.capturedAt } : {}),
        ...(args.encryption !== undefined ? { encryption: args.encryption } : {}),
        ...(args.location !== undefined ? { location: args.location } : {}),
      });
    } catch (error) {
      if (policy.isCloud) {
        await refundCloudUsage({
          ctx,
          owner: completeContext.billingOwner,
          entityId: completeContext.circleId,
          ...chargedUsage,
        });
      }

      throw error;
    }

    if (policy.isCloud && storageBytesDelta < 0) {
      await trackCloudOwnerUsage(ctx, {
        owner: completeContext.billingOwner,
        entityId: completeContext.circleId,
        featureId: BILLING_FEATURE_IDS.storageBytes,
        value: storageBytesDelta,
        properties: {
          uploadId: args.uploadId,
          circleId: completeContext.circleId,
        },
      });
    }

    return finalized;
  },
});

// Mirrors the schema union: discard reads rows written before the S3
// migration, so the legacy member stays until legacyStorage.migrateBatch has
// drained all 'convex-files' rows (see convex/legacyStorage.ts).
const storageReferenceValidator = v.union(
  v.object({
    provider: v.literal('convex-files'),
    storageId: v.id('_storage'),
  }),
  v.object({
    provider: v.literal('s3'),
    objectKey: v.string(),
    bucket: v.string(),
    region: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    basePath: v.optional(v.string()),
  }),
);

export const getDiscardContext = internalQuery({
  args: {
    uploadId: v.id('uploads'),
  },
  returns: v.union(
    v.object({ kind: v.literal('missing') }),
    v.object({ kind: v.literal('completed') }),
    v.object({
      kind: v.literal('discardable'),
      uploadId: v.id('uploads'),
      shareBatchId: v.id('shareBatches'),
      storageReferences: v.array(storageReferenceValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    // Stale client queue items may reference uploads that were already
    // discarded elsewhere or that completed into an asset. Report those as
    // outcomes instead of throwing so cleanup stays idempotent.
    if (!upload) {
      return { kind: 'missing' as const };
    }

    await requireCircleMembership(ctx, viewer._id, upload.circleId);

    const shareBatch = await ctx.db.get(upload.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    if (shareBatch.authorId !== viewer._id || shareBatch.status !== 'draft') {
      throw new Error('Only draft uploads owned by the author can be discarded.');
    }

    if (upload.assetId) {
      return { kind: 'completed' as const };
    }

    return {
      kind: 'discardable' as const,
      uploadId: upload._id,
      shareBatchId: upload.shareBatchId,
      storageReferences: [
        ...(upload.storage ? [upload.storage] : []),
        ...(upload.previewStorage ? [upload.previewStorage] : []),
        ...(upload.pendingStorage ? [upload.pendingStorage] : []),
        ...(upload.previewPendingStorage ? [upload.previewPendingStorage] : []),
      ],
    };
  },
});

export const finalizeDiscard = internalMutation({
  args: {
    uploadId: v.id('uploads'),
    shareBatchId: v.id('shareBatches'),
  },
  returns: v.object({
    uploadId: v.id('uploads'),
  }),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.uploadId);
    await ctx.db.patch(args.shareBatchId, {
      updatedAt: Date.now(),
    });

    return {
      uploadId: args.uploadId,
    };
  },
});

export const discard = action({
  args: {
    uploadId: v.id('uploads'),
  },
  returns: v.object({
    uploadId: v.id('uploads'),
    outcome: v.union(v.literal('discarded'), v.literal('completed'), v.literal('missing')),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    uploadId: Id<'uploads'>;
    outcome: 'discarded' | 'completed' | 'missing';
  }> => {
    const discardContext:
      | { kind: 'missing' }
      | { kind: 'completed' }
      | {
          kind: 'discardable';
          uploadId: Id<'uploads'>;
          shareBatchId: Id<'shareBatches'>;
          storageReferences: NonNullable<Doc<'uploads'>['pendingStorage']>[];
        } = await ctx.runQuery(internal.uploads.getDiscardContext, {
      uploadId: args.uploadId,
    });

    // Nothing to clean up server-side; let the client drop its stale item.
    if (discardContext.kind !== 'discardable') {
      return { uploadId: args.uploadId, outcome: discardContext.kind };
    }

    const uniqueStorageReferences = new Map<string, NonNullable<Doc<'uploads'>['pendingStorage']>>();

    for (const storageReference of discardContext.storageReferences) {
      uniqueStorageReferences.set(storageReferenceKey(storageReference), storageReference);
    }

    for (const storageReference of uniqueStorageReferences.values()) {
      await deleteStorageReference(ctx, storageReference);
    }

    const finalized = await ctx.runMutation(internal.uploads.finalizeDiscard, {
      uploadId: discardContext.uploadId,
      shareBatchId: discardContext.shareBatchId,
    });

    return { uploadId: finalized.uploadId, outcome: 'discarded' };
  },
});
