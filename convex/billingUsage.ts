import { v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalMutation, internalQuery } from './_generated/server';
import { currentPeriodKey } from './lib/billing/plans';

// Plan circle caps are single digits, so a bounded read stays cheap; the cap
// only exists to keep legacy data from turning this into a table scan.
const OWNED_CIRCLE_COUNT_LIMIT = 200;

/**
 * Circles a user pays for. Counts by `billingOwnerId`, plus legacy circles
 * created before that field existed (those bill their creator).
 */
export async function countOwnedCircles(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
): Promise<number> {
  const owned = await ctx.db
    .query('circles')
    .withIndex('by_billing_owner', (q) => q.eq('billingOwnerId', ownerId))
    .take(OWNED_CIRCLE_COUNT_LIMIT);
  const created = await ctx.db
    .query('circles')
    .withIndex('by_created_by', (q) => q.eq('createdBy', ownerId))
    .take(OWNED_CIRCLE_COUNT_LIMIT);
  const legacy = created.filter((circle) => circle.billingOwnerId === undefined);

  return owned.length + legacy.length;
}

export const getUsageForOwner = internalQuery({
  args: {
    ownerId: v.id('users'),
  },
  returns: v.object({
    periodKey: v.string(),
    uploadCount: v.number(),
    storageBytes: v.number(),
    circleCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const periodKey = currentPeriodKey();
    const usageRow = await ctx.db
      .query('billingUsage')
      .withIndex('by_owner_and_period', (q) =>
        q.eq('ownerId', args.ownerId).eq('periodKey', periodKey),
      )
      .unique();
    const storageRow = await ctx.db
      .query('billingStorage')
      .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
      .unique();

    return {
      periodKey,
      uploadCount: usageRow?.uploadCount ?? 0,
      storageBytes: storageRow?.totalBytes ?? 0,
      circleCount: await countOwnedCircles(ctx, args.ownerId),
    };
  },
});

export const adjustUsage = internalMutation({
  args: {
    ownerId: v.id('users'),
    mediaUploadsDelta: v.number(),
    storageBytesDelta: v.number(),
    /**
     * Optional hard cap for positive storage charges. Mutations are
     * transactions, so checking the current total and writing the new one here
     * closes the race where parallel completions each pass a pre-check.
     */
    maxStorageBytes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.mediaUploadsDelta !== 0) {
      const periodKey = currentPeriodKey();
      const usageRow = await ctx.db
        .query('billingUsage')
        .withIndex('by_owner_and_period', (q) =>
          q.eq('ownerId', args.ownerId).eq('periodKey', periodKey),
        )
        .unique();

      if (usageRow) {
        await ctx.db.patch(usageRow._id, {
          uploadCount: Math.max(0, usageRow.uploadCount + args.mediaUploadsDelta),
        });
      } else {
        await ctx.db.insert('billingUsage', {
          ownerId: args.ownerId,
          periodKey,
          uploadCount: Math.max(0, args.mediaUploadsDelta),
        });
      }
    }

    if (args.storageBytesDelta !== 0) {
      const storageRow = await ctx.db
        .query('billingStorage')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
        .unique();

      if (
        args.maxStorageBytes !== undefined &&
        args.storageBytesDelta > 0 &&
        (storageRow?.totalBytes ?? 0) + args.storageBytesDelta > args.maxStorageBytes
      ) {
        throw new Error('The cloud plan quota for this feature is exhausted.');
      }

      if (storageRow) {
        await ctx.db.patch(storageRow._id, {
          totalBytes: Math.max(0, storageRow.totalBytes + args.storageBytesDelta),
        });
      } else {
        await ctx.db.insert('billingStorage', {
          ownerId: args.ownerId,
          totalBytes: Math.max(0, args.storageBytesDelta),
        });
      }
    }

    return null;
  },
});
