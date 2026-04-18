import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { api, internal } from './_generated/api';
import { createS3ReadUrl } from './lib/storage/s3';
import {
  deleteStorageReference,
  resolveConvexReadUrl,
  storageReferenceKey,
} from './lib/storage/shared';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const assetFunctionSurface = [
  'assets.getReadUrl',
  'assets.listForShareBatch',
  'assets.deleteDraftAsset',
] as const;

interface ReadContext {
  assetId: Id<'assets'>;
  storage:
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

export const getReadContext = query({
  args: {
    assetId: v.id('assets'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const asset = await ctx.db.get(args.assetId);

    if (!asset) {
      throw new Error('Asset not found.');
    }

    await requireCircleMembership(ctx, viewer._id, asset.circleId);
    return {
      assetId: asset._id,
      storage: asset.previewStorage ?? asset.storage,
    };
  },
});

export const listForShareBatch = query({
  args: {
    shareBatchId: v.id('shareBatches'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    const assets = await ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', args.shareBatchId))
      .collect();

    return assets.map((asset) => ({
      _id: asset._id,
      _creationTime: asset._creationTime,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      storage: asset.storage,
      previewStorage: asset.previewStorage,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      location: asset.location,
    }));
  },
});

export const getReadUrl = action({
  args: {
    assetId: v.id('assets'),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string | null; expiresAt: number | null }> => {
    const context: ReadContext = await ctx.runQuery(api.assets.getReadContext, {
      assetId: args.assetId,
    });

    if (context.storage.provider === 'convex-files') {
      return await resolveConvexReadUrl(ctx, context.storage.storageId);
    }

    return await createS3ReadUrl({
      storage: context.storage,
    });
  },
});

export const getDeleteContext = internalQuery({
  args: {
    assetId: v.id('assets'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const asset = await ctx.db.get(args.assetId);

    if (!asset) {
      throw new Error('Asset not found.');
    }

    await requireCircleMembership(ctx, viewer._id, asset.circleId);

    const shareBatch = await ctx.db.get(asset.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    if (shareBatch.authorId !== viewer._id || shareBatch.status !== 'draft') {
      throw new Error('Only draft assets owned by the author can be deleted.');
    }

    const uploads = await ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .collect();
    const linkedUploads = uploads.filter((upload) => upload.assetId === asset._id);

    return {
      assetId: asset._id,
      shareBatchId: shareBatch._id,
      uploadIds: linkedUploads.map((upload) => upload._id),
      storageReferences: [
        asset.storage,
        ...(asset.previewStorage ? [asset.previewStorage] : []),
        ...linkedUploads.flatMap((upload) => (upload.storage ? [upload.storage] : [])),
        ...linkedUploads.flatMap((upload) => (upload.pendingStorage ? [upload.pendingStorage] : [])),
      ],
    };
  },
});

export const finalizeDelete = internalMutation({
  args: {
    assetId: v.id('assets'),
    shareBatchId: v.id('shareBatches'),
    uploadIds: v.array(v.id('uploads')),
  },
  handler: async (ctx, args) => {
    for (const uploadId of args.uploadIds) {
      await ctx.db.delete(uploadId);
    }

    await ctx.db.delete(args.assetId);
    await ctx.db.patch(args.shareBatchId, {
      updatedAt: Date.now(),
    });

    return {
      assetId: args.assetId,
    };
  },
});

export const deleteDraftAsset = action({
  args: {
    assetId: v.id('assets'),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    assetId: Id<'assets'>;
  }> => {
    const deleteContext: {
      assetId: Id<'assets'>;
      shareBatchId: Id<'shareBatches'>;
      uploadIds: Id<'uploads'>[];
      storageReferences: Doc<'assets'>['storage'][];
    } = await ctx.runQuery(internal.assets.getDeleteContext, {
      assetId: args.assetId,
    });

    const uniqueStorageReferences = new Map<string, Doc<'assets'>['storage']>();

    for (const storageReference of deleteContext.storageReferences) {
      uniqueStorageReferences.set(storageReferenceKey(storageReference), storageReference);
    }

    for (const storageReference of uniqueStorageReferences.values()) {
      await deleteStorageReference(ctx, storageReference);
    }

    return await ctx.runMutation(internal.assets.finalizeDelete, {
      assetId: deleteContext.assetId,
      shareBatchId: deleteContext.shareBatchId,
      uploadIds: deleteContext.uploadIds,
    });
  },
});
