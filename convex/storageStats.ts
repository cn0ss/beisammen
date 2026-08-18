import type {
  CircleUsageBreakdown,
  CircleUsageBreakdownItem,
  ConnectionCheck,
  StorageUsageStats,
} from '@beisammen/contracts';

import { v } from 'convex/values';

import { action, query } from './_generated/server';
import { getCircleStatsOrFallback } from './circleStats';
import { validateCurrentS3Configuration } from './lib/storage/s3';
import { getCurrentInstanceStorage, imageCacheKey } from './lib/storage/shared';
import { requireViewer } from './lib/viewer';

const STORAGE_STATS_CIRCLE_LIMIT = 100;

export const forViewer = query({
  args: {},
  handler: async (ctx): Promise<StorageUsageStats> => {
    const viewer = await requireViewer(ctx);
    let imageCount = 0;
    let videoCount = 0;
    let totalSizeBytes = 0;
    let circleCount = 0;

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user_and_joined_at', (q) => q.eq('userId', viewer._id))
      .order('desc')
      .take(STORAGE_STATS_CIRCLE_LIMIT + 1);
    const visibleMemberships = memberships.slice(0, STORAGE_STATS_CIRCLE_LIMIT);

    for (const membership of visibleMemberships) {
      const stats = await getCircleStatsOrFallback(ctx, membership.circleId);

      imageCount += stats.imageCount;
      videoCount += stats.videoCount;
      totalSizeBytes += stats.totalSizeBytes;
      circleCount += 1;
    }

    return {
      imageCount,
      videoCount,
      totalSizeBytes,
      circleCount,
      isTruncated: memberships.length > STORAGE_STATS_CIRCLE_LIMIT,
    };
  },
});

export const perCircleForViewer = query({
  args: {},
  returns: v.object({
    circles: v.array(
      v.object({
        circleId: v.string(),
        name: v.string(),
        hasImage: v.boolean(),
        imageKey: v.optional(v.string()),
        isOwner: v.boolean(),
        memberCount: v.number(),
        imageCount: v.number(),
        videoCount: v.number(),
        totalSizeBytes: v.number(),
      }),
    ),
    isTruncated: v.boolean(),
  }),
  handler: async (ctx): Promise<CircleUsageBreakdown> => {
    const viewer = await requireViewer(ctx);
    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user_and_joined_at', (q) => q.eq('userId', viewer._id))
      .order('desc')
      .take(STORAGE_STATS_CIRCLE_LIMIT + 1);
    const visibleMemberships = memberships.slice(0, STORAGE_STATS_CIRCLE_LIMIT);

    const circles: CircleUsageBreakdownItem[] = [];

    for (const membership of visibleMemberships) {
      const circle = await ctx.db.get(membership.circleId);

      if (!circle) {
        continue;
      }

      const stats = await getCircleStatsOrFallback(ctx, circle._id);

      circles.push({
        circleId: circle._id,
        name: circle.name,
        hasImage: Boolean(circle.imageStorage),
        imageKey: imageCacheKey(circle.imageStorage),
        isOwner: membership.role === 'owner',
        memberCount: stats.memberCount,
        imageCount: stats.imageCount,
        videoCount: stats.videoCount,
        totalSizeBytes: stats.totalSizeBytes,
      });
    }

    circles.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes);

    return {
      circles,
      isTruncated: memberships.length > STORAGE_STATS_CIRCLE_LIMIT,
    };
  },
});

export const checkConnection = action({
  args: {},
  handler: async (ctx): Promise<ConnectionCheck> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error('Authenticated user required.');
    }

    try {
      return await validateCurrentS3Configuration(getCurrentInstanceStorage());
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Storage connection check failed.',
      };
    }
  },
});
