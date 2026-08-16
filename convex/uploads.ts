import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { adjustCircleStats, assetStatsDelta } from './circleStats';
import { BILLING_FEATURE_IDS } from './lib/billing/autumn';
import {
  type BillingOwner,
  requireCloudOwnerFeatureAccess,
  resolveCircleBillingOwner,
  trackCloudOwnerUsage,
} from './lib/billing/owner';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { canPublish } from './lib/permissions';
import { createS3UploadTarget, verifyS3ObjectExists } from './lib/storage/s3';
import {
  buildS3ObjectKey,
  buildS3PreviewObjectKey,
  buildS3StorageReference,
  deleteStorageReference,
  getCurrentInstanceStorage,
  storageReferenceKey,
} from './lib/storage/shared';
import {
  assertCompletedUploadWithinBetaLimits,
  assertDraftHasMediaCapacity,
  assertUploadTargetWithinBetaLimits,
} from './lib/uploadLimits';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const uploadFunctionSurface = [
  'uploads.createTarget',
  'uploads.complete',
  'uploads.retry',
  'uploads.discard',
] as const;

interface PreparedUploadContext {
  uploadId: Id<'uploads'>;
  providerKind: 'convex-files' | 's3';
  mimeType: string;
  fileName: string;
  kind: 'image' | 'video';
  shareBatchId: Id<'shareBatches'>;
  circleId: Id<'circles'>;
  pendingStorage?:
    | {
        provider: 'convex-files';
        storageId: Id<'_storage'>;
      }
    | {
        provider: 's3';
        objectKey: string;
        bucket: string;
        region?: string;
        endpoint?: string;
        basePath?: string;
      };
  previewPendingStorage?:
    | {
        provider: 'convex-files';
        storageId: Id<'_storage'>;
      }
    | {
        provider: 's3';
        objectKey: string;
        bucket: string;
        region?: string;
        endpoint?: string;
        basePath?: string;
      };
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
}

interface CompleteUploadContext {
  uploadId: Id<'uploads'>;
  providerKind: 'convex-files' | 's3';
  circleId: Id<'circles'>;
  billingOwner: BillingOwner;
  hasAsset: boolean;
  existingAssetSizeBytes: number;
  pendingStorage?:
    | {
        provider: 'convex-files';
        storageId: Id<'_storage'>;
      }
    | {
        provider: 's3';
        objectKey: string;
        bucket: string;
        region?: string;
        endpoint?: string;
        basePath?: string;
      };
  previewPendingStorage?:
    | {
        provider: 'convex-files';
        storageId: Id<'_storage'>;
      }
    | {
        provider: 's3';
        objectKey: string;
        bucket: string;
        region?: string;
        endpoint?: string;
        basePath?: string;
      };
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
      console.error('Failed to refund Autumn usage after upload failure.', error);
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

  assertUploadTargetWithinBetaLimits({
    kind: args.kind,
    mimeType: args.mimeType,
    fileName: args.fileName,
  });
  await assertDraftHasMediaCapacity(ctx, args.shareBatchId);

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

  return {
    uploadId: upload._id,
    circleId: upload.circleId,
    billingOwner: await resolveCircleBillingOwner(ctx, upload.circleId),
  };
}

export const authorizeCreateTarget = internalQuery({
  args: {
    circleId: v.id('circles'),
    shareBatchId: v.id('shareBatches'),
    mimeType: v.string(),
    kind: v.union(v.literal('image'), v.literal('video')),
    fileName: v.string(),
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

    await authorizeRetryRequest(ctx, args.uploadId);

    await ctx.db.patch(upload._id, {
      status: 'uploading',
      failureReason: undefined,
    });

    return {
      uploadId: upload._id,
      providerKind: upload.providerKind,
      mimeType: upload.mimeType,
      fileName: upload.fileName,
      kind: upload.kind,
      shareBatchId: upload.shareBatchId,
      circleId: upload.circleId,
      pendingStorage: upload.pendingStorage,
      previewPendingStorage: upload.previewPendingStorage,
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
  },
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();
    const billingContext: AuthorizedCreateTargetContext = await ctx.runQuery(
      internal.uploads.authorizeCreateTarget,
      args,
    );

    if (policy.isCloud) {
      await requireCloudOwnerFeatureAccess(ctx, {
        owner: billingContext.billingOwner,
        entityId: billingContext.circleId,
        featureId: BILLING_FEATURE_IDS.mediaUploads,
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
    });
    const previewTarget =
      prepared.previewPendingStorage && prepared.previewPendingStorage.provider === 's3'
        ? await createS3UploadTarget({
            storage: prepared.previewPendingStorage,
            mimeType: 'image/jpeg',
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
        featureId: BILLING_FEATURE_IDS.mediaUploads,
      });
    }

    const prepared: PreparedUploadContext = await ctx.runMutation(
      internal.uploads.prepareRetry,
      args,
    );

    if (!prepared.pendingStorage || prepared.pendingStorage.provider !== 's3') {
      throw new Error('S3 upload target could not be recreated.');
    }

    const target = await createS3UploadTarget({
      storage: prepared.pendingStorage,
      mimeType: prepared.mimeType,
    });
    const previewTarget =
      prepared.previewPendingStorage && prepared.previewPendingStorage.provider === 's3'
        ? await createS3UploadTarget({
            storage: prepared.previewPendingStorage,
            mimeType: 'image/jpeg',
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
    const existingAsset = upload.assetId ? await ctx.db.get(upload.assetId) : null;
    const billingOwner = await resolveCircleBillingOwner(ctx, upload.circleId);

    return {
      uploadId: upload._id,
      providerKind: upload.providerKind,
      circleId: upload.circleId,
      billingOwner,
      hasAsset: Boolean(upload.assetId),
      existingAssetSizeBytes: existingAsset?.sizeBytes ?? 0,
      pendingStorage: upload.pendingStorage,
      previewPendingStorage: upload.previewPendingStorage,
    };
  },
});

export const finalizeComplete = internalMutation({
  args: {
    uploadId: v.id('uploads'),
    storageId: v.optional(v.id('_storage')),
    previewStorageId: v.optional(v.id('_storage')),
    previewObjectKey: v.optional(v.string()),
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
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

    const shareBatch = await requireUploadCompletionAuthor(ctx, upload, viewer._id);
    assertCompletedUploadWithinBetaLimits({
      kind: upload.kind,
      mimeType: upload.mimeType,
      fileName: args.fileName?.trim() || upload.fileName,
      durationSeconds: args.durationSeconds,
    });

    // Legacy: convex-files branch retained for existing in-flight uploads
    const storage =
      upload.providerKind === 'convex-files'
        ? args.storageId
          ? {
              provider: 'convex-files' as const,
              storageId: args.storageId,
            }
          : null
        : upload.pendingStorage && upload.pendingStorage.provider === 's3'
          ? upload.pendingStorage
          : null;
    const previewStorage =
      upload.providerKind === 'convex-files'
        ? args.previewStorageId
          ? {
              provider: 'convex-files' as const,
              storageId: args.previewStorageId,
            }
          : null
        : args.previewObjectKey &&
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

    await assertDraftHasMediaCapacity(ctx, upload.shareBatchId, upload._id);

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
    storageId: v.optional(v.id('_storage')),
    objectKey: v.optional(v.string()),
    previewStorageId: v.optional(v.id('_storage')),
    previewObjectKey: v.optional(v.string()),
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
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
    let serverObservedSizeBytes: number | undefined;

    // Legacy: convex-files branch retained for existing in-flight uploads
    if (completeContext.providerKind === 'convex-files') {
      if (!args.storageId) {
        throw new Error('Convex file uploads must provide a storageId.');
      }

      const storedFileUrl = await ctx.storage.getUrl(args.storageId);

      if (!storedFileUrl) {
        throw new Error('Uploaded Convex file was not found.');
      }

      if (args.previewStorageId) {
        const storedPreviewUrl = await ctx.storage.getUrl(args.previewStorageId);

        if (!storedPreviewUrl) {
          throw new Error('Uploaded Convex preview file was not found.');
        }
      }
    } else {
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
      serverObservedSizeBytes = verifiedOriginal.sizeBytes;

      if (args.previewObjectKey) {
        const previewPendingStorage = completeContext.previewPendingStorage;

        if (!previewPendingStorage || previewPendingStorage.provider !== 's3') {
          throw new Error('Completed upload is missing its S3 preview storage reference.');
        }

        if (args.previewObjectKey !== previewPendingStorage.objectKey) {
          throw new Error('Completed preview object key does not match the prepared target.');
        }

        await verifyS3ObjectExists({
          storage: previewPendingStorage,
        });
      }
    }

    const policy = getDeploymentPolicyFromEnv();
    const mediaUploadsDelta = completeContext.hasAsset ? 0 : 1;
    const completedSizeBytes =
      completeContext.providerKind === 's3' ? serverObservedSizeBytes : args.sizeBytes;
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
        ...(args.storageId ? { storageId: args.storageId } : {}),
        ...(args.previewStorageId ? { previewStorageId: args.previewStorageId } : {}),
        ...(args.previewObjectKey ? { previewObjectKey: args.previewObjectKey } : {}),
        ...(args.fileName !== undefined ? { fileName: args.fileName } : {}),
        ...(completedSizeBytes !== undefined ? { sizeBytes: completedSizeBytes } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.durationSeconds !== undefined ? { durationSeconds: args.durationSeconds } : {}),
        ...(args.capturedAt !== undefined ? { capturedAt: args.capturedAt } : {}),
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

export const getDiscardContext = internalQuery({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

    if (!upload) {
      throw new Error('Upload not found.');
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
      throw new Error('Completed uploads must be deleted via their asset.');
    }

    return {
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
  handler: async (
    ctx,
    args,
  ): Promise<{
    uploadId: Id<'uploads'>;
  }> => {
    const discardContext: {
      uploadId: Id<'uploads'>;
      shareBatchId: Id<'shareBatches'>;
      storageReferences: Doc<'uploads'>['pendingStorage'][];
    } = await ctx.runQuery(internal.uploads.getDiscardContext, {
      uploadId: args.uploadId,
    });

    const uniqueStorageReferences = new Map<string, NonNullable<Doc<'uploads'>['pendingStorage']>>();

    for (const storageReference of discardContext.storageReferences) {
      if (!storageReference) {
        continue;
      }

      uniqueStorageReferences.set(storageReferenceKey(storageReference), storageReference);
    }

    for (const storageReference of uniqueStorageReferences.values()) {
      await deleteStorageReference(ctx, storageReference);
    }

    return await ctx.runMutation(internal.uploads.finalizeDiscard, {
      uploadId: discardContext.uploadId,
      shareBatchId: discardContext.shareBatchId,
    });
  },
});
