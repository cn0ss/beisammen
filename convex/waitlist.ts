import { v } from 'convex/values';

import { type MutationCtx, internalMutation } from './_generated/server';
import { rateLimiter } from './rateLimit';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailAddress(email: string): boolean {
  return emailPattern.test(email);
}

type UpsertEntryArgs = {
  email: string;
  locale: 'en' | 'de';
  source: 'landing';
  referrer?: string;
  userAgent?: string;
};

async function upsertWaitlistEntry(
  ctx: MutationCtx,
  args: UpsertEntryArgs,
): Promise<{ alreadyJoined: boolean }> {
  const normalizedEmail = normalizeEmailAddress(args.email);

  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error('A valid email address is required.');
  }

  const now = Date.now();
  const existing = await ctx.db
    .query('waitlistEntries')
    .withIndex('by_normalized_email', (q) =>
      q.eq('normalizedEmail', normalizedEmail),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      email: args.email.trim(),
      locale: args.locale,
      source: args.source,
      ...(args.referrer ? { referrer: args.referrer } : {}),
      ...(args.userAgent ? { userAgent: args.userAgent } : {}),
      lastSeenAt: now,
      submissionCount: existing.submissionCount + 1,
    });

    return {
      alreadyJoined: true,
    };
  }

  await ctx.db.insert('waitlistEntries', {
    email: args.email.trim(),
    normalizedEmail,
    locale: args.locale,
    source: args.source,
    ...(args.referrer ? { referrer: args.referrer } : {}),
    ...(args.userAgent ? { userAgent: args.userAgent } : {}),
    firstSeenAt: now,
    lastSeenAt: now,
    submissionCount: 1,
  });

  return {
    alreadyJoined: false,
  };
}

export const upsertEntry = internalMutation({
  args: {
    email: v.string(),
    locale: v.union(v.literal('en'), v.literal('de')),
    source: v.literal('landing'),
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => upsertWaitlistEntry(ctx, args),
});

export const joinFromHttp = internalMutation({
  args: {
    email: v.string(),
    locale: v.union(v.literal('en'), v.literal('de')),
    source: v.literal('landing'),
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await rateLimiter.limit(ctx, 'waitlistJoinGlobal', { throws: true });

    if (args.clientIp) {
      await rateLimiter.limit(ctx, 'waitlistJoinByIp', {
        key: args.clientIp,
        throws: true,
      });
    }

    return upsertWaitlistEntry(ctx, args);
  },
});
