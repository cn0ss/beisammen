import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { internal } from './_generated/api';
import { adjustCircleStats, assetStatsDelta } from './circleStats';
import { BILLING_FEATURE_IDS } from './lib/billing/autumn';
import {
  type BillingOwner,
  resolveCircleBillingOwner,
  trackCloudOwnerUsage,
} from './lib/billing/owner';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { listShareAssetsForDisplay } from './lib/shareAssets';
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

const ASSET_LINKED_UPLOAD_DELETE_LIMIT = 20;

type AssetVisibilityCtx = QueryCtx;

interface ReadContext {
  assetId: Id<'assets'>;
  variant: 'preview' | 'original';
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

async function requireAssetVisibleToViewer(
  ctx: AssetVisibilityCtx,
  asset: Doc<'assets'>,
  viewerId: Id<'users'>,
) {
  await requireCircleMembership(ctx, viewerId, asset.circleId);

  const shareBatch = await ctx.db.get(asset.shareBatchId);

  if (!shareBatch || shareBatch.circleId !== asset.circleId) {
    throw new Error('Share batch not found for asset.');
  }

  if (shareBatch.status === 'draft' && shareBatch.authorId !== viewerId) {
    throw new Error('Draft assets are only visible to the draft author.');
  }

  return shareBatch;
}

function requireShareBatchVisibleToViewer(
  shareBatch: Doc<'shareBatches'>,
  viewerId: Id<'users'>,
) {
  if (shareBatch.status === 'draft' && shareBatch.authorId !== viewerId) {
    throw new Error('Draft assets are only visible to the draft author.');
  }
}

export const getReadContext = internalQuery({
  args: {
    assetId: v.id('assets'),
    variant: v.optional(v.union(v.literal('preview'), v.literal('original'))),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const asset = await ctx.db.get(args.assetId);

    if (!asset) {
      throw new Error('Asset not found.');
    }

    await requireAssetVisibleToViewer(ctx, asset, viewer._id);
    const variant = args.variant ?? 'preview';

    return {
      assetId: asset._id,
      variant,
      storage: variant === 'original' ? asset.storage : asset.previewStorage ?? asset.storage,
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
    requireShareBatchVisibleToViewer(shareBatch, viewer._id);

    const assets = await listShareAssetsForDisplay(ctx, args.shareBatchId);

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
    variant: v.optional(v.union(v.literal('preview'), v.literal('original'))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string | null; expiresAt: number | null }> => {
    const context: ReadContext = await ctx.runQuery(internal.assets.getReadContext, {
      assetId: args.assetId,
      ...(args.variant ? { variant: args.variant } : {}),
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

    const linkedUploads = await ctx.db
      .query('uploads')
      .withIndex('by_asset', (q) => q.eq('assetId', asset._id))
      .take(ASSET_LINKED_UPLOAD_DELETE_LIMIT + 1);

    if (linkedUploads.length > ASSET_LINKED_UPLOAD_DELETE_LIMIT) {
      throw new Error('Asset has too many linked uploads to delete in one request.');
    }

    const billingOwner = await resolveCircleBillingOwner(ctx, asset.circleId);

    return {
      assetId: asset._id,
      shareBatchId: shareBatch._id,
      circleId: asset.circleId,
      billingOwner,
      storageBytesDelta: -(asset.sizeBytes ?? 0),
      uploadIds: linkedUploads.map((upload) => upload._id),
      storageReferences: [
        asset.storage,
        ...(asset.previewStorage ? [asset.previewStorage] : []),
        ...linkedUploads.flatMap((upload) => (upload.storage ? [upload.storage] : [])),
        ...linkedUploads.flatMap((upload) => (upload.previewStorage ? [upload.previewStorage] : [])),
        ...linkedUploads.flatMap((upload) => (upload.pendingStorage ? [upload.pendingStorage] : [])),
        ...linkedUploads.flatMap((upload) =>
          upload.previewPendingStorage ? [upload.previewPendingStorage] : [],
        ),
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
    const asset = await ctx.db.get(args.assetId);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    for (const uploadId of args.uploadIds) {
      await ctx.db.delete(uploadId);
    }

    await ctx.db.delete(args.assetId);
    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await ctx.db.patch(args.shareBatchId, {
      assetCount: Math.max(0, shareBatch.assetCount - 1),
      updatedAt: Date.now(),
    });

    if (asset) {
      await adjustCircleStats(ctx, asset.circleId, assetStatsDelta(asset, -1));
    }

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
      circleId: Id<'circles'>;
      billingOwner: BillingOwner;
      storageBytesDelta: number;
      uploadIds: Id<'uploads'>[];
      storageReferences: Doc<'assets'>['storage'][];
    } = await ctx.runQuery(internal.assets.getDeleteContext, {
      assetId: args.assetId,
    }) as unknown as {
      assetId: Id<'assets'>;
      shareBatchId: Id<'shareBatches'>;
      circleId: Id<'circles'>;
      billingOwner: BillingOwner;
      storageBytesDelta: number;
      uploadIds: Id<'uploads'>[];
      storageReferences: Doc<'assets'>['storage'][];
    };
    const policy = getDeploymentPolicyFromEnv();

    const uniqueStorageReferences = new Map<string, Doc<'assets'>['storage']>();

    for (const storageReference of deleteContext.storageReferences) {
      uniqueStorageReferences.set(storageReferenceKey(storageReference), storageReference);
    }

    let creditedStorageBytes = 0;

    try {
      if (policy.isCloud && deleteContext.storageBytesDelta < 0) {
        await trackCloudOwnerUsage(ctx, {
          owner: deleteContext.billingOwner,
          entityId: deleteContext.circleId,
          featureId: BILLING_FEATURE_IDS.storageBytes,
          value: deleteContext.storageBytesDelta,
          properties: {
            assetId: deleteContext.assetId,
            circleId: deleteContext.circleId,
          },
        });
        creditedStorageBytes = -deleteContext.storageBytesDelta;
      }

      for (const storageReference of uniqueStorageReferences.values()) {
        await deleteStorageReference(ctx, storageReference);
      }

      return await ctx.runMutation(internal.assets.finalizeDelete, {
        assetId: deleteContext.assetId,
        shareBatchId: deleteContext.shareBatchId,
        uploadIds: deleteContext.uploadIds,
      });
    } catch (error) {
      if (policy.isCloud && creditedStorageBytes > 0) {
        try {
          await trackCloudOwnerUsage(ctx, {
            owner: deleteContext.billingOwner,
            entityId: deleteContext.circleId,
            featureId: BILLING_FEATURE_IDS.storageBytes,
            value: creditedStorageBytes,
            properties: {
              assetId: deleteContext.assetId,
              circleId: deleteContext.circleId,
            },
          });
        } catch (refundError) {
          console.error('Failed to refund Autumn storage credit after asset delete failure.', refundError);
        }
      }

      throw error;
    }
  },
});
