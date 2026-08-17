import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { internalMutation, internalQuery } from './_generated/server';
import { isEmailConfigured, resend, retentionEmailFrom } from './email';
import { isBillingConfigured, resolveOwnerPlanTier } from './lib/billing/quota';
import { getDeploymentPolicyFromEnv } from './lib/instance';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention policy for lapsed billing owners (also stated in the ToS):
 * uploads stop immediately when the plan lapses (enforced by the quota
 * layer); stored media stays viewable through a 12-month grace period that
 * starts when the lapse is first detected. After grace, up to three warning
 * emails go out 30 days apart; 30 days after the final warning the account's
 * media becomes ELIGIBLE for deletion. Deletion itself is a manual admin
 * step — nothing here removes data.
 */
export const RETENTION_GRACE_MS = 365 * DAY_MS;
export const RETENTION_WARNING_INTERVAL_MS = 30 * DAY_MS;
export const RETENTION_MAX_WARNINGS = 3;

const SWEEP_BATCH_SIZE = 100;

function warningSubject(warningNumber: number): string {
  return warningNumber >= RETENTION_MAX_WARNINGS
    ? 'Letzte Erinnerung: Deine Fotos und Videos bei Beisammen'
    : 'Deine Fotos und Videos bei Beisammen';
}

function warningHtml(input: { displayName: string; warningNumber: number }): string {
  const finalNotice =
    input.warningNumber >= RETENTION_MAX_WARNINGS
      ? '<p><strong>Dies ist die letzte Erinnerung.</strong> Ohne aktiven Tarif können deine gespeicherten Fotos und Videos in 30 Tagen endgültig entfernt werden.</p>'
      : '<p>Ohne aktiven Tarif können deine gespeicherten Fotos und Videos nach weiteren Erinnerungen endgültig entfernt werden.</p>';

  return [
    `<p>Hallo ${input.displayName},</p>`,
    '<p>dein Beisammen-Tarif ist seit über einem Jahr abgelaufen. Deine Fotos und Videos sind weiterhin gespeichert und für deine Circles sichtbar — neue Uploads sind ohne Tarif nicht möglich.</p>',
    finalNotice,
    '<p>Wenn du deinen Tarif in der App wieder aktivierst, bleibt alles genau so, wie es ist.</p>',
    '<p>Dein Beisammen-Team</p>',
  ].join('\n');
}

async function sendRetentionWarning(
  ctx: MutationCtx,
  owner: Doc<'users'>,
  warningNumber: number,
): Promise<boolean> {
  const email = owner.email?.trim();

  // Warnings only count when a real email went out; without an address (or
  // Resend configured) the row simply stays lapsed for admin follow-up.
  if (!email || !isEmailConfigured()) {
    return false;
  }

  await resend.sendEmail(ctx, {
    from: retentionEmailFrom(),
    to: email,
    subject: warningSubject(warningNumber),
    html: warningHtml({
      displayName: owner.displayName?.trim() || 'liebes Beisammen-Mitglied',
      warningNumber,
    }),
  });

  return true;
}

async function sweepOwner(ctx: MutationCtx, storageRow: Doc<'billingStorage'>): Promise<void> {
  const now = Date.now();
  const retentionRow = await ctx.db
    .query('billingRetention')
    .withIndex('by_owner', (q) => q.eq('ownerId', storageRow.ownerId))
    .unique();

  if (storageRow.totalBytes <= 0) {
    if (retentionRow) {
      await ctx.db.delete(retentionRow._id);
    }

    return;
  }

  let tier;

  try {
    tier = await resolveOwnerPlanTier(ctx, storageRow.ownerId);
  } catch (error) {
    // Provider hiccups must never start (or advance) a retention clock.
    console.error('Retention sweep could not check entitlements.', error);

    return;
  }

  if (tier) {
    // Win-back: an active plan clears all retention state.
    if (retentionRow) {
      await ctx.db.delete(retentionRow._id);
    }

    return;
  }

  if (!retentionRow) {
    await ctx.db.insert('billingRetention', {
      ownerId: storageRow.ownerId,
      lapsedAt: now,
      warningCount: 0,
      updatedAt: now,
    });

    return;
  }

  const graceOver = retentionRow.lapsedAt + RETENTION_GRACE_MS <= now;
  const warningDue =
    retentionRow.lastWarnedAt === undefined ||
    retentionRow.lastWarnedAt + RETENTION_WARNING_INTERVAL_MS <= now;

  if (!graceOver || !warningDue || retentionRow.warningCount >= RETENTION_MAX_WARNINGS) {
    return;
  }

  const owner = await ctx.db.get(storageRow.ownerId);

  if (!owner) {
    await ctx.db.delete(retentionRow._id);

    return;
  }

  const warningNumber = retentionRow.warningCount + 1;
  const sent = await sendRetentionWarning(ctx, owner, warningNumber);

  if (!sent) {
    return;
  }

  await ctx.db.patch(retentionRow._id, {
    warningCount: warningNumber,
    lastWarnedAt: now,
    updatedAt: now,
    ...(warningNumber >= RETENTION_MAX_WARNINGS
      ? { deletableAt: now + RETENTION_WARNING_INTERVAL_MS }
      : {}),
  });
}

export const sweep = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted || !isBillingConfigured()) {
      return null;
    }

    const page = await ctx.db
      .query('billingStorage')
      .paginate({ numItems: SWEEP_BATCH_SIZE, cursor: args.cursor ?? null });

    for (const storageRow of page.page) {
      await sweepOwner(ctx, storageRow);
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.billingRetention.sweep, {
        cursor: page.continueCursor,
      });
    }

    return null;
  },
});

/** Owners whose grace and warnings ran out; deletion remains a manual step. */
export const listDeletable = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      ownerId: v.id('users'),
      email: v.union(v.string(), v.null()),
      displayName: v.union(v.string(), v.null()),
      totalBytes: v.number(),
      lapsedAt: v.number(),
      deletableAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const now = Date.now();
    // gte(1) excludes rows without deletableAt (undefined sorts first).
    const rows = await ctx.db
      .query('billingRetention')
      .withIndex('by_deletable_at', (q) => q.gte('deletableAt', 1).lte('deletableAt', now))
      .take(100);
    const results = [];

    for (const row of rows) {
      if (row.deletableAt === undefined) {
        continue;
      }

      const owner = await ctx.db.get(row.ownerId);
      const storageRow = await ctx.db
        .query('billingStorage')
        .withIndex('by_owner', (q) => q.eq('ownerId', row.ownerId))
        .unique();

      results.push({
        ownerId: row.ownerId,
        email: owner?.email ?? null,
        displayName: owner?.displayName ?? null,
        totalBytes: storageRow?.totalBytes ?? 0,
        lapsedAt: row.lapsedAt,
        deletableAt: row.deletableAt,
      });
    }

    return results;
  },
});
