import type { NotificationKind } from '@beisammen/contracts';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'share.published',
  'comment.created',
  'reaction.set',
];

const NOTIFICATION_DEVICE_SCAN_LIMIT = 20;
const NOTIFICATION_ACTIVE_DEVICE_LIMIT = 5;

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as string[]).includes(value);
}

function notificationsProviderConfigured(): boolean {
  return Boolean(process.env.EXPO_PUSH_ACCESS_TOKEN?.trim());
}

async function notificationPreferenceEnabled(
  ctx: MutationCtx,
  input: {
    userId: Id<'users'>;
    kind: NotificationKind;
  },
): Promise<boolean> {
  const preference = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_user_and_kind', (q) =>
      q.eq('userId', input.userId).eq('kind', input.kind),
    )
    .first();

  return preference?.enabled ?? true;
}

export async function enqueueNotificationDeliveryAttempts(
  ctx: MutationCtx,
  input: {
    activityEventId: Id<'activityEvents'>;
    recipients: Array<{
      inboxItemId: Id<'activityInboxItems'>;
      userId: Id<'users'>;
    }>;
    circleId: Id<'circles'>;
    type: string;
    shareBatchId: Id<'shareBatches'>;
    assetId?: Id<'assets'>;
    createdAt: number;
  },
) {
  if (!isNotificationKind(input.type)) {
    return;
  }

  const providerConfigured = notificationsProviderConfigured();

  for (const recipient of input.recipients) {
    const preferenceEnabled = await notificationPreferenceEnabled(ctx, {
      userId: recipient.userId,
      kind: input.type,
    });

    if (!preferenceEnabled) {
      await ctx.db.insert('notificationDeliveryAttempts', {
        activityEventId: input.activityEventId,
        inboxItemId: recipient.inboxItemId,
        userId: recipient.userId,
        circleId: input.circleId,
        kind: input.type,
        shareBatchId: input.shareBatchId,
        ...(input.assetId ? { assetId: input.assetId } : {}),
        provider: 'expo',
        status: 'skipped',
        skipReason: 'preference_disabled',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
      continue;
    }

    const devices = await ctx.db
      .query('notificationDevices')
      .withIndex('by_user', (q) => q.eq('userId', recipient.userId))
      .order('desc')
      .take(NOTIFICATION_DEVICE_SCAN_LIMIT);
    const activeDevices = devices
      .filter((device) => device.disabledAt === undefined)
      .slice(0, NOTIFICATION_ACTIVE_DEVICE_LIMIT);

    if (activeDevices.length === 0) {
      await ctx.db.insert('notificationDeliveryAttempts', {
        activityEventId: input.activityEventId,
        inboxItemId: recipient.inboxItemId,
        userId: recipient.userId,
        circleId: input.circleId,
        kind: input.type,
        shareBatchId: input.shareBatchId,
        ...(input.assetId ? { assetId: input.assetId } : {}),
        provider: 'expo',
        status: 'skipped',
        skipReason: 'no_device',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
      continue;
    }

    for (const device of activeDevices) {
      await ctx.db.insert('notificationDeliveryAttempts', {
        activityEventId: input.activityEventId,
        inboxItemId: recipient.inboxItemId,
        userId: recipient.userId,
        deviceId: device._id,
        circleId: input.circleId,
        kind: input.type,
        shareBatchId: input.shareBatchId,
        ...(input.assetId ? { assetId: input.assetId } : {}),
        provider: 'expo',
        status: providerConfigured ? 'queued' : 'skipped',
        ...(providerConfigured ? {} : { skipReason: 'provider_not_configured' as const }),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
    }
  }
}
