import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { internal } from './_generated/api';
import { adjustCircleStats, assetStatsDelta } from './circleStats';
import {
  BILLING_FEATURE_IDS,
  type BillingOwner,
  resolveCircleBillingOwner,
  trackCloudOwnerUsage,
} from './lib/billing/quota';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';
import { listShareAssetsForDisplay } from './lib/shareAssets';
import { createS3ReadUrl } from './lib/storage/s3';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const assetFunctionSurface = [
  'assets.getReadUrl',
  'assets.listForShareBatch',
  'assets.listMetadataForCircle',
  'assets.deleteDraftAsset',
] as const;

const ASSET_LINKED_UPLOAD_DELETE_LIMIT = 20;

type AssetVisibilityCtx = QueryCtx;

interface ReadContext {
  assetId: Id<'assets'>;
  variant: 'preview' | 'original' | 'pairedVideo';
  kind: Doc<'assets'>['kind'];
  mimeType: string;
  encryption?: Doc<'assets'>['encryption'];
  // Schema-shaped: rows written before the S3 migration may still carry a
  // legacy 'convex-files' reference. Reads reject those; see getReadUrl.
  storage: Doc<'assets'>['storage'];
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
    variant: v.optional(
      v.union(v.literal('preview'), v.literal('original'), v.literal('pairedVideo')),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const asset = await ctx.db.get(args.assetId);

    if (!asset) {
      throw new Error('Asset not found.');
    }

    await requireAssetVisibleToViewer(ctx, asset, viewer._id);
    const variant = args.variant ?? 'preview';

    if (variant === 'pairedVideo' && !asset.pairedVideoStorage) {
      throw new Error('Asset has no paired video.');
    }

    return {
      assetId: asset._id,
      variant,
      kind: asset.kind,
      mimeType:
        variant === 'pairedVideo'
          ? asset.pairedVideoMimeType ?? 'video/mp4'
          : asset.mimeType,
      // Imperative consumers (downloads) need the envelope to decrypt without
      // issuing a separate query for the asset projection.
      ...(asset.encryption ? { encryption: asset.encryption } : {}),
      storage:
        variant === 'original'
          ? asset.storage
          : variant === 'pairedVideo'
            ? asset.pairedVideoStorage ?? asset.storage
            : asset.previewStorage ?? asset.storage,
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
      pairedVideoStorage: asset.pairedVideoStorage,
      pairedVideoMimeType: asset.pairedVideoMimeType,
      pairedVideoDurationSeconds: asset.pairedVideoDurationSeconds,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      location: asset.location,
      capturedAt: asset.capturedAt,
      encryption: asset.encryption,
    }));
  },
});

/**
 * Paginated metadata feed for client-side aggregation (map/places). Encrypted
 * assets carry their sealed envelope; legacy assets still expose plaintext
 * location so both generations land on the same client-built map.
 */
export const listMetadataForCircle = query({
  args: {
    circleId: v.id('circles'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const page = await ctx.db
      .query('assets')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .order('desc')
      .paginate(args.paginationOpts);
    const items = [];

    for (const asset of page.page) {
      const shareBatch = await ctx.db.get(asset.shareBatchId);

      // Draft assets stay private to their author, mirroring the read rules.
      if (!shareBatch || (shareBatch.status === 'draft' && shareBatch.authorId !== viewer._id)) {
        continue;
      }

      items.push({
        _id: asset._id,
        shareBatchId: asset.shareBatchId,
        kind: asset.kind,
        capturedAt: asset.capturedAt,
        createdAt: asset.createdAt,
        location: asset.location,
        encryption: asset.encryption,
      });
    }

    return {
      ...page,
      page: items,
    };
  },
});

export const getReadUrl = action({
  args: {
    assetId: v.id('assets'),
    variant: v.optional(
      v.union(v.literal('preview'), v.literal('original'), v.literal('pairedVideo')),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string | null;
    expiresAt: number | null;
    kind: 'image' | 'video';
    mimeType: string;
    encryption?: {
      v: 1;
      circleEpoch: number;
      wrappedFileKey: string;
      encMetadata?: string;
    };
  }> => {
    const context: ReadContext = await ctx.runQuery(internal.assets.getReadContext, {
      assetId: args.assetId,
      ...(args.variant ? { variant: args.variant } : {}),
    });
    // The convex-files read path is gone so no media bytes ever flow through
    // Convex bandwidth. Remaining legacy rows must be moved to S3 first via
    // `npx convex run legacyStorage:migrateBatch`.
    if (context.storage.provider !== 's3') {
      throw new Error('Legacy media must be migrated to S3.');
    }

    const signed = await createS3ReadUrl({ storage: context.storage });

    // The signed URL points at ciphertext when `encryption` is set; returning
    // the envelope lets imperative consumers decrypt without another query.
    return {
      ...signed,
      kind: context.kind,
      mimeType: context.mimeType,
      ...(context.encryption ? { encryption: context.encryption } : {}),
    };
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
      storageBytesDelta: -((asset.sizeBytes ?? 0) + (asset.pairedVideoSizeBytes ?? 0)),
      uploadIds: linkedUploads.map((upload) => upload._id),
      storageReferences: [
        asset.storage,
        ...(asset.previewStorage ? [asset.previewStorage] : []),
        ...(asset.pairedVideoStorage ? [asset.pairedVideoStorage] : []),
        ...linkedUploads.flatMap((upload) => (upload.storage ? [upload.storage] : [])),
        ...linkedUploads.flatMap((upload) => (upload.previewStorage ? [upload.previewStorage] : [])),
        ...linkedUploads.flatMap((upload) =>
          upload.pairedVideoStorage ? [upload.pairedVideoStorage] : [],
        ),
        ...linkedUploads.flatMap((upload) => (upload.pendingStorage ? [upload.pendingStorage] : [])),
        ...linkedUploads.flatMap((upload) =>
          upload.previewPendingStorage ? [upload.previewPendingStorage] : [],
        ),
        ...linkedUploads.flatMap((upload) =>
          upload.pairedVideoPendingStorage ? [upload.pairedVideoPendingStorage] : [],
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
          console.error('Failed to refund storage credit after asset delete failure.', refundError);
        }
      }

      throw error;
    }
  },
});
