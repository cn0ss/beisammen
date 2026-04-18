import { v } from 'convex/values';

import { internalMutation } from './_generated/server';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailAddress(email: string): boolean {
  return emailPattern.test(email);
}

export const upsertEntry = internalMutation({
  args: {
    email: v.string(),
    locale: v.union(v.literal('en'), v.literal('de')),
    source: v.literal('landing'),
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
  },
});
