import type { StorageUsageStats } from '@beisammen/contracts';

import { query } from './_generated/server';
import { requireViewer } from './lib/viewer';

export const forViewer = query({
  args: {},
  handler: async (ctx): Promise<StorageUsageStats> => {
    const viewer = await requireViewer(ctx);

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .collect();

    let imageCount = 0;
    let videoCount = 0;
    let totalSizeBytes = 0;

    for (const membership of memberships) {
      const assets = await ctx.db
        .query('assets')
        .withIndex('by_circle', (q) => q.eq('circleId', membership.circleId))
        .collect();

      for (const asset of assets) {
        if (asset.kind === 'image') {
          imageCount++;
        } else {
          videoCount++;
        }
        totalSizeBytes += asset.sizeBytes ?? 0;
      }
    }

    return { imageCount, videoCount, totalSizeBytes };
  },
});
