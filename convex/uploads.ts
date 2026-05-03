import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { canPublish } from './lib/permissions';
import { createS3UploadTarget, verifyS3ObjectExists } from './lib/storage/s3';
import {
  buildS3ObjectKey,
  buildS3StorageReference,
  deleteStorageReference,
  getCurrentInstanceStorage,
  storageReferenceKey,
} from './lib/storage/shared';
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
}

interface CompleteUploadContext {
  uploadId: Id<'uploads'>;
  providerKind: 'convex-files' | 's3';
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
}

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

    const pendingStorage = buildS3StorageReference({
      objectKey: buildS3ObjectKey({
        circleId: args.circleId,
        shareBatchId: args.shareBatchId,
        mimeType: args.mimeType.trim(),
        kind: args.kind,
        fileName: args.fileName.trim(),
        uploadId,
      }),
    });

    await ctx.db.patch(uploadId, {
      pendingStorage,
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
    };
  },
});

export const prepareRetry = internalMutation({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const upload = await ctx.db.get(args.uploadId);

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
    const prepared: PreparedUploadContext = await ctx.runMutation(
      internal.uploads.prepareCreateTarget,
      args,
    );

    if (!prepared.pendingStorage || prepared.pendingStorage.provider !== 's3') {
      throw new Error('S3 upload target could not be prepared.');
    }

    return {
      uploadId: prepared.uploadId,
      target: await createS3UploadTarget({
        storage: prepared.pendingStorage,
        mimeType: prepared.mimeType,
      }),
    };
  },
});

export const retry = action({
  args: {
    uploadId: v.id('uploads'),
  },
  handler: async (ctx, args) => {
    const prepared: PreparedUploadContext = await ctx.runMutation(
      internal.uploads.prepareRetry,
      args,
    );

    if (!prepared.pendingStorage || prepared.pendingStorage.provider !== 's3') {
      throw new Error('S3 upload target could not be recreated.');
    }

    return {
      uploadId: prepared.uploadId,
      target: await createS3UploadTarget({
        storage: prepared.pendingStorage,
        mimeType: prepared.mimeType,
      }),
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

    await requireCircleMembership(ctx, viewer._id, upload.circleId);

    return {
      uploadId: upload._id,
      providerKind: upload.providerKind,
      circleId: upload.circleId,
      pendingStorage: upload.pendingStorage,
    };
  },
});

export const finalizeComplete = internalMutation({
  args: {
    uploadId: v.id('uploads'),
    storageId: v.optional(v.id('_storage')),
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
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

    await requireCircleMembership(ctx, viewer._id, upload.circleId);

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
      location: args.location,
    };

    if (upload.assetId) {
      await ctx.db.patch(upload.assetId, {
        storage,
        ...nextAssetFields,
      });
      await ctx.db.patch(upload.shareBatchId, {
        updatedAt: now,
      });
      await ctx.db.patch(upload._id, {
        storage,
        status: 'uploaded',
        completedAt: now,
      });

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
      createdAt: now,
      width: nextAssetFields.width,
      height: nextAssetFields.height,
      durationSeconds: nextAssetFields.durationSeconds,
      location: nextAssetFields.location,
    });

    await ctx.db.patch(upload._id, {
      assetId,
      storage,
      status: 'uploaded',
      completedAt: now,
    });
    await ctx.db.patch(upload.shareBatchId, {
      updatedAt: now,
    });

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
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
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

    // Legacy: convex-files branch retained for existing in-flight uploads
    if (completeContext.providerKind === 'convex-files') {
      if (!args.storageId) {
        throw new Error('Convex file uploads must provide a storageId.');
      }

      const storedFileUrl = await ctx.storage.getUrl(args.storageId);

      if (!storedFileUrl) {
        throw new Error('Uploaded Convex file was not found.');
      }
    } else {
      const pendingStorage = completeContext.pendingStorage;

      if (!pendingStorage || pendingStorage.provider !== 's3') {
        throw new Error('Completed upload is missing its S3 storage reference.');
      }

      if (args.objectKey && args.objectKey !== pendingStorage.objectKey) {
        throw new Error('Completed upload object key does not match the prepared target.');
      }

      await verifyS3ObjectExists({
        storage: pendingStorage,
      });
    }

    return await ctx.runMutation(internal.uploads.finalizeComplete, {
      uploadId: args.uploadId,
      storageId: args.storageId,
      fileName: args.fileName,
      sizeBytes: args.sizeBytes,
      width: args.width,
      height: args.height,
      durationSeconds: args.durationSeconds,
      location: args.location,
    });
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
        ...(upload.pendingStorage ? [upload.pendingStorage] : []),
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
