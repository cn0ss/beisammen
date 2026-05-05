import { paginationOptsValidator } from 'convex/server';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation } from './_generated/server';

interface CircleStatsDelta {
  memberCount?: number;
  imageCount?: number;
  videoCount?: number;
  totalSizeBytes?: number;
}

type StatsCtx = QueryCtx | MutationCtx;

function emptyStats(circleId: Id<'circles'>) {
  return {
    circleId,
    memberCount: 0,
    imageCount: 0,
    videoCount: 0,
    totalSizeBytes: 0,
  };
}

function statsFromDelta(circleId: Id<'circles'>, delta: CircleStatsDelta) {
  return {
    circleId,
    memberCount: clampCount(delta.memberCount ?? 0),
    imageCount: clampCount(delta.imageCount ?? 0),
    videoCount: clampCount(delta.videoCount ?? 0),
    totalSizeBytes: clampCount(delta.totalSizeBytes ?? 0),
    updatedAt: Date.now(),
  };
}

function clampCount(value: number): number {
  return Math.max(0, value);
}

async function getStatsDoc(
  ctx: StatsCtx,
  circleId: Id<'circles'>,
): Promise<Doc<'circleStats'> | null> {
  return await ctx.db
    .query('circleStats')
    .withIndex('by_circle', (q) => q.eq('circleId', circleId))
    .unique();
}

export async function computeCircleStatsSnapshot(
  ctx: StatsCtx,
  circleId: Id<'circles'>,
) {
  const snapshot = emptyStats(circleId);

  for await (const member of ctx.db
    .query('circleMembers')
    .withIndex('by_circle', (q) => q.eq('circleId', circleId))) {
    void member;
    snapshot.memberCount += 1;
  }

  for await (const asset of ctx.db
    .query('assets')
    .withIndex('by_circle', (q) => q.eq('circleId', circleId))) {
    if (asset.kind === 'image') {
      snapshot.imageCount += 1;
    } else {
      snapshot.videoCount += 1;
    }

    snapshot.totalSizeBytes += asset.sizeBytes ?? 0;
  }

  return snapshot;
}

export async function getCircleStatsOrFallback(
  ctx: StatsCtx,
  circleId: Id<'circles'>,
) {
  const stats = await getStatsDoc(ctx, circleId);

  if (stats) {
    return stats;
  }

  return {
    ...(await computeCircleStatsSnapshot(ctx, circleId)),
    _id: null,
    _creationTime: null,
    updatedAt: Date.now(),
  };
}

export async function recomputeCircleStats(
  ctx: MutationCtx,
  circleId: Id<'circles'>,
) {
  const snapshot = await computeCircleStatsSnapshot(ctx, circleId);
  const existing = await getStatsDoc(ctx, circleId);
  const next = {
    ...snapshot,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, next);
    return existing._id;
  }

  return await ctx.db.insert('circleStats', next);
}

export async function adjustCircleStats(
  ctx: MutationCtx,
  circleId: Id<'circles'>,
  delta: CircleStatsDelta,
) {
  const existing = await getStatsDoc(ctx, circleId);

  if (!existing) {
    await ctx.db.insert('circleStats', statsFromDelta(circleId, delta));
    return;
  }

  await ctx.db.patch(existing._id, {
    memberCount: clampCount(existing.memberCount + (delta.memberCount ?? 0)),
    imageCount: clampCount(existing.imageCount + (delta.imageCount ?? 0)),
    videoCount: clampCount(existing.videoCount + (delta.videoCount ?? 0)),
    totalSizeBytes: clampCount(existing.totalSizeBytes + (delta.totalSizeBytes ?? 0)),
    updatedAt: Date.now(),
  });
}

export function assetStatsDelta(
  asset: Pick<Doc<'assets'>, 'kind' | 'sizeBytes'>,
  direction: 1 | -1,
): CircleStatsDelta {
  return {
    imageCount: asset.kind === 'image' ? direction : 0,
    videoCount: asset.kind === 'video' ? direction : 0,
    totalSizeBytes: direction * (asset.sizeBytes ?? 0),
  };
}

export const backfillBatch = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<{
    processed: number;
    isDone: boolean;
    continueCursor: string;
  }> => {
    const page = await ctx.db.query('circles').order('asc').paginate(args.paginationOpts);

    for (const circle of page.page) {
      await recomputeCircleStats(ctx, circle._id);
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.circleStats.backfillBatch, {
        paginationOpts: {
          numItems: args.paginationOpts.numItems,
          cursor: page.continueCursor,
        },
      });
    }

    return {
      processed: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
