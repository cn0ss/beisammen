import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import {
  deleteStorageReference,
  formatFeedTimestamp,
  storageReferenceKey,
} from './lib/storage/shared';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const shareFunctionSurface = [
  'shares.getOrCreateDraft',
  'shares.getDraftForCircle',
  'shares.updateDraft',
  'shares.publish',
  'shares.getById',
  'shares.deleteShare',
  'shares.listForCircle',
] as const;

function mapAsset(asset: Doc<'assets'>) {
  return {
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
  };
}

async function listAssets(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
) {
  const assets = await ctx.db
    .query('assets')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))
    .collect();

  return assets.map(mapAsset);
}

async function buildPublishedShareRecord(
  ctx: QueryCtx | MutationCtx,
  shareBatch: Doc<'shareBatches'>,
  viewerId: Id<'users'>,
) {
  const author = await ctx.db.get(shareBatch.authorId);
  const assets = await listAssets(ctx, shareBatch._id);

  return {
    _id: shareBatch._id,
    _creationTime: shareBatch._creationTime,
    circleId: shareBatch.circleId,
    caption: shareBatch.caption ?? '',
    assetCount: shareBatch.assetCount,
    authorId: shareBatch.authorId,
    authorName: author?.displayName ?? author?.email ?? 'Unbekannt',
    authorAvatarUrl: author?.avatarUrl,
    authorHasProfileImage: Boolean(author?.profileImageStorage),
    createdAtLabel: formatFeedTimestamp(shareBatch.publishedAt ?? shareBatch.createdAt),
    publishedAt: shareBatch.publishedAt ?? shareBatch.createdAt,
    canDelete: shareBatch.authorId === viewerId,
    assets,
  };
}

export const getOrCreateDraft = mutation({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);
    const [existingDraft] = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_author_and_status', (q) =>
        q.eq('circleId', args.circleId).eq('authorId', viewer._id).eq('status', 'draft'),
      )
      .order('desc')
      .take(1);

    if (existingDraft) {
      return {
        shareBatchId: existingDraft._id,
      };
    }

    const now = Date.now();

    const shareBatchId = await ctx.db.insert('shareBatches', {
      circleId: args.circleId,
      authorId: viewer._id,
      assetCount: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });

    return {
      shareBatchId,
    };
  },
});

export const getDraftForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);
    const [draft] = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_author_and_status', (q) =>
        q.eq('circleId', args.circleId).eq('authorId', viewer._id).eq('status', 'draft'),
      )
      .order('desc')
      .take(1);

    if (!draft) {
      return null;
    }

    const assets = await listAssets(ctx, draft._id);

    return {
      _id: draft._id,
      _creationTime: draft._creationTime,
      circleId: draft.circleId,
      caption: draft.caption ?? '',
      assetCount: assets.length,
      updatedAt: draft.updatedAt,
      assets,
    };
  },
});

export const updateDraft = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.authorId !== viewer._id || shareBatch.status !== 'draft') {
      throw new Error('Only the author can update this draft.');
    }

    await ctx.db.patch(shareBatch._id, {
      caption: args.caption?.trim() || undefined,
      updatedAt: Date.now(),
    });

    return {
      shareBatchId: shareBatch._id,
    };
  },
});

export const publish = mutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      throw new Error('Share batch not found.');
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.authorId !== viewer._id) {
      throw new Error('Only the author can publish this draft.');
    }

    if (shareBatch.status !== 'draft') {
      throw new Error('Only drafts can be published.');
    }

    const assets = await ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .collect();

    if (assets.length === 0) {
      throw new Error('At least one uploaded asset is required before publishing.');
    }

    const now = Date.now();
    await ctx.db.patch(shareBatch._id, {
      status: 'published',
      assetCount: assets.length,
      ...(args.caption !== undefined ? { caption: args.caption.trim() || undefined } : {}),
      updatedAt: now,
      publishedAt: now,
    });
    await ctx.db.insert('activityEvents', {
      circleId: shareBatch.circleId,
      actorId: viewer._id,
      type: 'share.published',
      entityId: shareBatch._id,
      createdAt: now,
    });

    return {
      shareBatchId: shareBatch._id,
      assetCount: assets.length,
    };
  },
});

export const getById = query({
  args: {
    shareBatchId: v.id('shareBatches'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const shareBatch = await ctx.db.get(args.shareBatchId);

    if (!shareBatch) {
      return null;
    }

    await requireCircleMembership(ctx, viewer._id, shareBatch.circleId);

    if (shareBatch.status === 'draft' && shareBatch.authorId !== viewer._id) {
      throw new Error('Draft not found.');
    }

    return await buildPublishedShareRecord(ctx, shareBatch, viewer._id);
  },
});

export const listForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const shareBatches = await ctx.db
      .query('shareBatches')
      .withIndex('by_circle_and_status', (q) =>
        q.eq('circleId', args.circleId).eq('status', 'published'),
      )
      .order('desc')
      .collect();

    return await Promise.all(
      shareBatches.map((shareBatch) => buildPublishedShareRecord(ctx, shareBatch, viewer._id)),
    );
  },
});

export const getDeleteContext = internalQuery({
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

    if (shareBatch.authorId !== viewer._id) {
      throw new Error('Only the author can delete this post.');
    }

    const assets = await ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .collect();
    const uploads = await ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatch._id))
      .collect();

    return {
      shareBatchId: shareBatch._id,
      circleId: shareBatch.circleId,
      assetIds: assets.map((asset) => asset._id),
      uploadIds: uploads.map((upload) => upload._id),
      storageReferences: [
        ...assets.flatMap((asset) => [asset.storage, ...(asset.previewStorage ? [asset.previewStorage] : [])]),
        ...uploads.flatMap((upload) => (upload.storage ? [upload.storage] : [])),
        ...uploads.flatMap((upload) => (upload.pendingStorage ? [upload.pendingStorage] : [])),
      ],
    };
  },
});

export const finalizeDelete = internalMutation({
  args: {
    shareBatchId: v.id('shareBatches'),
    circleId: v.id('circles'),
    assetIds: v.array(v.id('assets')),
    uploadIds: v.array(v.id('uploads')),
  },
  handler: async (ctx, args) => {
    for (const assetId of args.assetIds) {
      await ctx.db.delete(assetId);
    }

    for (const uploadId of args.uploadIds) {
      await ctx.db.delete(uploadId);
    }

    const activityEvents = await ctx.db
      .query('activityEvents')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .take(100);

    for (const event of activityEvents) {
      if (event.entityId === args.shareBatchId) {
        await ctx.db.delete(event._id);
      }
    }

    await ctx.db.delete(args.shareBatchId);

    return {
      shareBatchId: args.shareBatchId,
    };
  },
});

export const deleteShare = action({
  args: {
    shareBatchId: v.id('shareBatches'),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    shareBatchId: Id<'shareBatches'>;
  }> => {
    const deleteContext: {
      shareBatchId: Id<'shareBatches'>;
      circleId: Id<'circles'>;
      assetIds: Id<'assets'>[];
      uploadIds: Id<'uploads'>[];
      storageReferences: Doc<'assets'>['storage'][];
    } = await ctx.runQuery(internal.shares.getDeleteContext, {
      shareBatchId: args.shareBatchId,
    });

    const uniqueStorageReferences = new Map<string, Doc<'assets'>['storage']>();

    for (const storageReference of deleteContext.storageReferences) {
      uniqueStorageReferences.set(storageReferenceKey(storageReference), storageReference);
    }

    for (const storageReference of uniqueStorageReferences.values()) {
      await deleteStorageReference(ctx, storageReference);
    }

    return await ctx.runMutation(internal.shares.finalizeDelete, {
      shareBatchId: deleteContext.shareBatchId,
      circleId: deleteContext.circleId,
      assetIds: deleteContext.assetIds,
      uploadIds: deleteContext.uploadIds,
    });
  },
});
