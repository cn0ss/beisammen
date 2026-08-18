import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { deleteStorageReference, storageReferenceKey } from './legacyStorage';

const DEFAULT_STALE_MEDIA_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_MEDIA_CLEANUP_BATCH_SIZE = 50;
const STALE_UPLOAD_STATUSES: Array<Doc<'uploads'>['status']> = ['uploading', 'failed'];
const STALE_IMAGE_UPLOAD_STATUSES: Array<Doc<'imageUploads'>['status']> = [
  'uploading',
  'failed',
];

type CleanupStorageReference = NonNullable<Doc<'uploads'>['pendingStorage']>;

type CleanupCandidate =
  | {
      source: 'uploads';
      id: Id<'uploads'>;
      storageReferences: CleanupStorageReference[];
    }
  | {
      source: 'imageUploads';
      id: Id<'imageUploads'>;
      storageReferences: CleanupStorageReference[];
    };

function normalizeBatchSize(batchSize?: number): number {
  if (!batchSize || !Number.isFinite(batchSize)) {
    return STALE_MEDIA_CLEANUP_BATCH_SIZE;
  }

  return Math.max(1, Math.min(STALE_MEDIA_CLEANUP_BATCH_SIZE, Math.floor(batchSize)));
}

function normalizeOlderThanMs(olderThanMs?: number): number {
  if (!olderThanMs || !Number.isFinite(olderThanMs)) {
    return DEFAULT_STALE_MEDIA_AGE_MS;
  }

  return Math.max(1, Math.floor(olderThanMs));
}

function uniqueStorageReferences(
  storageReferences: CleanupStorageReference[],
): CleanupStorageReference[] {
  const unique = new Map<string, CleanupStorageReference>();

  for (const storageReference of storageReferences) {
    unique.set(storageReferenceKey(storageReference), storageReference);
  }

  return Array.from(unique.values());
}

function uploadStorageReferences(upload: Doc<'uploads'>): CleanupStorageReference[] {
  return [
    ...(upload.pendingStorage ? [upload.pendingStorage] : []),
    ...(upload.previewPendingStorage ? [upload.previewPendingStorage] : []),
    ...(upload.pairedVideoPendingStorage ? [upload.pairedVideoPendingStorage] : []),
    ...(upload.storage ? [upload.storage] : []),
    ...(upload.previewStorage ? [upload.previewStorage] : []),
    ...(upload.pairedVideoStorage ? [upload.pairedVideoStorage] : []),
  ];
}

function imageUploadStorageReferences(
  upload: Doc<'imageUploads'>,
): CleanupStorageReference[] {
  return [
    ...(upload.pendingStorage ? [upload.pendingStorage] : []),
    ...(upload.storage ? [upload.storage] : []),
  ];
}

export const getStaleCleanupBatch = internalQuery({
  args: {
    cutoffCreatedAt: v.number(),
    batchSize: v.number(),
  },
  handler: async (ctx, args): Promise<{
    candidates: CleanupCandidate[];
    hasMore: boolean;
  }> => {
    const batchSize = normalizeBatchSize(args.batchSize);
    const candidates: CleanupCandidate[] = [];
    let hasMore = false;

    for (const status of STALE_UPLOAD_STATUSES) {
      const remaining = batchSize - candidates.length;

      if (remaining <= 0) {
        const [extra] = await ctx.db
          .query('uploads')
          .withIndex('by_status_and_created_at', (q) =>
            q.eq('status', status).lt('createdAt', args.cutoffCreatedAt),
          )
          .take(1);
        hasMore = hasMore || Boolean(extra);
        continue;
      }

      const rows = await ctx.db
        .query('uploads')
        .withIndex('by_status_and_created_at', (q) =>
          q.eq('status', status).lt('createdAt', args.cutoffCreatedAt),
        )
        .order('asc')
        .take(remaining + 1);

      if (rows.length > remaining) {
        hasMore = true;
      }

      for (const upload of rows.slice(0, remaining)) {
        if (upload.assetId) {
          continue;
        }

        candidates.push({
          source: 'uploads',
          id: upload._id,
          storageReferences: uniqueStorageReferences(uploadStorageReferences(upload)),
        });
      }
    }

    for (const status of STALE_IMAGE_UPLOAD_STATUSES) {
      const remaining = batchSize - candidates.length;

      if (remaining <= 0) {
        const [extra] = await ctx.db
          .query('imageUploads')
          .withIndex('by_status_and_created_at', (q) =>
            q.eq('status', status).lt('createdAt', args.cutoffCreatedAt),
          )
          .take(1);
        hasMore = hasMore || Boolean(extra);
        continue;
      }

      const rows = await ctx.db
        .query('imageUploads')
        .withIndex('by_status_and_created_at', (q) =>
          q.eq('status', status).lt('createdAt', args.cutoffCreatedAt),
        )
        .order('asc')
        .take(remaining + 1);

      if (rows.length > remaining) {
        hasMore = true;
      }

      for (const upload of rows.slice(0, remaining)) {
        candidates.push({
          source: 'imageUploads',
          id: upload._id,
          storageReferences: uniqueStorageReferences(imageUploadStorageReferences(upload)),
        });
      }
    }

    return {
      candidates,
      hasMore,
    };
  },
});

export const finalizeStaleCleanup = internalMutation({
  args: {
    cutoffCreatedAt: v.number(),
    uploadIds: v.array(v.id('uploads')),
    imageUploadIds: v.array(v.id('imageUploads')),
  },
  handler: async (ctx, args): Promise<{
    deleted: number;
  }> => {
    let deleted = 0;

    for (const uploadId of args.uploadIds) {
      const upload = await ctx.db.get(uploadId);

      if (
        !upload ||
        upload.assetId ||
        upload.status === 'uploaded' ||
        upload.createdAt >= args.cutoffCreatedAt
      ) {
        continue;
      }

      await ctx.db.delete(upload._id);
      deleted += 1;
    }

    for (const uploadId of args.imageUploadIds) {
      const upload = await ctx.db.get(uploadId);

      if (!upload || upload.status === 'uploaded' || upload.createdAt >= args.cutoffCreatedAt) {
        continue;
      }

      await ctx.db.delete(upload._id);
      deleted += 1;
    }

    return {
      deleted,
    };
  },
});

export const cleanupStale = internalAction({
  args: {
    now: v.optional(v.number()),
    olderThanMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    continueOnMore: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    scanned: number;
    deleted: number;
    failed: number;
    hasMore: boolean;
  }> => {
    const batchSize = normalizeBatchSize(args.batchSize);
    const cutoffCreatedAt = (args.now ?? Date.now()) - normalizeOlderThanMs(args.olderThanMs);
    const batch: {
      candidates: CleanupCandidate[];
      hasMore: boolean;
    } = await ctx.runQuery(internal.mediaCleanup.getStaleCleanupBatch, {
      cutoffCreatedAt,
      batchSize,
    });
    const uploadIds: Id<'uploads'>[] = [];
    const imageUploadIds: Id<'imageUploads'>[] = [];
    let failed = 0;

    for (const candidate of batch.candidates) {
      try {
        for (const storageReference of candidate.storageReferences) {
          await deleteStorageReference(ctx, storageReference);
        }

        if (candidate.source === 'uploads') {
          uploadIds.push(candidate.id);
        } else {
          imageUploadIds.push(candidate.id);
        }
      } catch (error) {
        failed += 1;
        console.error('Failed to delete stale media storage reference.', {
          source: candidate.source,
          id: candidate.id,
          error,
        });
      }
    }

    const finalized: { deleted: number } = await ctx.runMutation(
      internal.mediaCleanup.finalizeStaleCleanup,
      {
        cutoffCreatedAt,
        uploadIds,
        imageUploadIds,
      },
    );
    const hasMore = batch.hasMore || failed > 0;

    if (args.continueOnMore && batch.hasMore && failed === 0) {
      const nextArgs: {
        now?: number;
        olderThanMs?: number;
        batchSize: number;
        continueOnMore: boolean;
      } = {
        batchSize,
        continueOnMore: true,
      };

      if (args.now !== undefined) {
        nextArgs.now = args.now;
      }

      if (args.olderThanMs !== undefined) {
        nextArgs.olderThanMs = args.olderThanMs;
      }

      await ctx.scheduler.runAfter(0, internal.mediaCleanup.cleanupStale, nextArgs);
    }

    return {
      scanned: batch.candidates.length,
      deleted: finalized.deleted,
      failed,
      hasMore,
    };
  },
});
