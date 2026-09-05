import { v } from 'convex/values';

import type {
  NotificationDeviceRegistration,
  NotificationKind,
  NotificationPreference,
} from '@beisammen/contracts';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  expoPushAccessToken,
  fetchExpoPushReceipts,
  sendExpoPushMessages,
  type ExpoPushMessage,
} from './lib/expoPush';
import { NOTIFICATION_KINDS } from './lib/notifications';
import { requireViewer } from './lib/viewer';

const notificationKindValidator = v.union(
  v.literal('share.published'),
  v.literal('comment.created'),
  v.literal('reaction.set'),
);

const notificationPlatformValidator = v.union(
  v.literal('ios'),
  v.literal('android'),
  v.literal('web'),
  v.literal('unknown'),
);
const PUSH_SEND_BATCH_SIZE = 100;
const PUSH_SCAN_BATCH_SIZE = 300;
const PUSH_RECEIPT_BATCH_SIZE = 100;
const PUSH_RECEIPT_READY_AFTER_MS = 15 * 60 * 1000;
const NOTIFICATION_DEVICE_TOKEN_SCAN_LIMIT = 20;

type QueuedSendAttempt = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  deviceId: Id<'notificationDevices'> | null;
  deviceToken: string | null;
  title: string;
  body: string;
  data: Record<string, string>;
  failureReason: string | null;
};

type QueuedReceiptAttempt = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  deviceId: Id<'notificationDevices'> | null;
  providerMessageId: string;
};

type SendMarkResult = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  status: 'sent' | 'failed';
  providerMessageId?: string;
  errorMessage?: string;
  disableDevice?: boolean;
};

type ReceiptMarkResult = {
  attemptId: Id<'notificationDeliveryAttempts'>;
  status: 'delivered' | 'failed';
  errorMessage?: string;
  disableDevice?: boolean;
};

const sendMarkResultValidator = v.object({
  attemptId: v.id('notificationDeliveryAttempts'),
  status: v.union(v.literal('sent'), v.literal('failed')),
  providerMessageId: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  disableDevice: v.optional(v.boolean()),
});

const receiptMarkResultValidator = v.object({
  attemptId: v.id('notificationDeliveryAttempts'),
  status: v.union(v.literal('delivered'), v.literal('failed')),
  errorMessage: v.optional(v.string()),
  disableDevice: v.optional(v.boolean()),
});

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function notificationCopy(input: {
  actorName: string;
  circleName: string;
  kind: NotificationKind;
}): { title: string; body: string } {
  switch (input.kind) {
    case 'comment.created':
      return {
        title: `${input.actorName} hat kommentiert`,
        body: `Neue Antwort in ${input.circleName}`,
      };
    case 'reaction.set':
      return {
        title: `${input.actorName} hat reagiert`,
        body: `Neue Reaktion in ${input.circleName}`,
      };
    case 'share.published':
      return {
        title: `${input.actorName} hat etwas geteilt`,
        body: `Neuer Beitrag in ${input.circleName}`,
      };
  }
}

function ticketErrorMessage(ticket: { message?: string; details?: { error?: string } }): string {
  return ticket.message ?? ticket.details?.error ?? 'Expo push ticket failed.';
}

function receiptErrorMessage(receipt: { message?: string; details?: { error?: string } }): string {
  return receipt.message ?? receipt.details?.error ?? 'Expo push receipt failed.';
}

function toExpoMessage(attempt: QueuedSendAttempt): ExpoPushMessage {
  return {
    to: attempt.deviceToken ?? '',
    title: attempt.title,
    body: attempt.body,
    data: attempt.data,
  };
}

export const registerDevice = mutation({
  args: {
    instanceUrl: v.string(),
    token: v.string(),
    platform: notificationPlatformValidator,
    appVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NotificationDeviceRegistration> => {
    const viewer = await requireViewer(ctx);
    const now = Date.now();
    const instanceUrl = normalizeRequiredString(args.instanceUrl, 'Instance URL');
    const deviceToken = normalizeRequiredString(args.token, 'Notification device token');
    const existing = await ctx.db
      .query('notificationDevices')
      .withIndex('by_user_and_instance_url_and_token', (q) =>
        q
          .eq('userId', viewer._id)
          .eq('instanceUrl', instanceUrl)
          .eq('deviceToken', deviceToken),
      )
      .first();
    const tokenRows = await ctx.db
      .query('notificationDevices')
      .withIndex('by_device_token', (q) => q.eq('deviceToken', deviceToken))
      .take(NOTIFICATION_DEVICE_TOKEN_SCAN_LIMIT);

    for (const row of tokenRows) {
      if (row._id === existing?._id || row.disabledAt !== undefined) {
        continue;
      }

      await ctx.db.patch(row._id, {
        disabledAt: now,
        updatedAt: now,
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        provider: 'expo',
        platform: args.platform,
        ...(args.appVersion ? { appVersion: args.appVersion } : {}),
        updatedAt: now,
        lastRegisteredAt: now,
        disabledAt: undefined,
      });

      return {
        deviceId: existing._id,
        instanceUrl,
        platform: args.platform,
        provider: 'expo',
        registeredAt: now,
      };
    }

    const deviceId = await ctx.db.insert('notificationDevices', {
      userId: viewer._id,
      instanceUrl,
      deviceToken,
      provider: 'expo',
      platform: args.platform,
      ...(args.appVersion ? { appVersion: args.appVersion } : {}),
      createdAt: now,
      updatedAt: now,
      lastRegisteredAt: now,
    });

    return {
      deviceId,
      instanceUrl,
      platform: args.platform,
      provider: 'expo',
      registeredAt: now,
    };
  },
});

export const unregisterDevice = mutation({
  args: {
    instanceUrl: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    const viewer = await requireViewer(ctx);
    const instanceUrl = normalizeRequiredString(args.instanceUrl, 'Instance URL');
    const deviceToken = normalizeRequiredString(args.token, 'Notification device token');
    const existing = await ctx.db
      .query('notificationDevices')
      .withIndex('by_user_and_instance_url_and_token', (q) =>
        q
          .eq('userId', viewer._id)
          .eq('instanceUrl', instanceUrl)
          .eq('deviceToken', deviceToken),
      )
      .first();

    if (!existing || existing.disabledAt !== undefined) {
      return { removed: false };
    }

    await ctx.db.patch(existing._id, {
      disabledAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { removed: true };
  },
});

export const getPreferences = query({
  args: {},
  handler: async (ctx): Promise<NotificationPreference[]> => {
    const viewer = await requireViewer(ctx);
    const stored = await Promise.all(
      NOTIFICATION_KINDS.map(async (kind) => {
        return await ctx.db
          .query('notificationPreferences')
          .withIndex('by_user_and_kind', (q) =>
            q.eq('userId', viewer._id).eq('kind', kind),
          )
          .first();
      }),
    );

    return NOTIFICATION_KINDS.map((kind, index) => ({
      kind,
      enabled: stored[index]?.enabled ?? true,
      updatedAt: stored[index]?.updatedAt ?? null,
    }));
  },
});

export const updatePreferences = mutation({
  args: {
    kind: notificationKindValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args): Promise<NotificationPreference> => {
    const viewer = await requireViewer(ctx);
    const now = Date.now();
    const kind = args.kind as NotificationKind;
    const existing = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user_and_kind', (q) =>
        q.eq('userId', viewer._id).eq('kind', kind),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('notificationPreferences', {
        userId: viewer._id,
        kind,
        enabled: args.enabled,
        updatedAt: now,
      });
    }

    return {
      kind,
      enabled: args.enabled,
      updatedAt: now,
    };
  },
});

export const getQueuedSendBatch = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<QueuedSendAttempt[]> => {
    const rows = await ctx.db
      .query('notificationDeliveryAttempts')
      .withIndex('by_status_and_updated_at', (q) => q.eq('status', 'queued'))
      .order('asc')
      .take(PUSH_SCAN_BATCH_SIZE);
    const candidates = rows
      .filter((attempt) => !attempt.providerMessageId)
      .slice(0, Math.min(args.limit, PUSH_SEND_BATCH_SIZE));
    const batch: QueuedSendAttempt[] = [];

    for (const attempt of candidates) {
      const [activityEvent, circle, device] = await Promise.all([
        ctx.db.get(attempt.activityEventId),
        ctx.db.get(attempt.circleId),
        attempt.deviceId ? ctx.db.get(attempt.deviceId) : Promise.resolve(null),
      ]);

      if (!attempt.deviceId || !device || device.disabledAt !== undefined) {
        batch.push({
          attemptId: attempt._id,
          deviceId: attempt.deviceId ?? null,
          deviceToken: null,
          title: '',
          body: '',
          data: {},
          failureReason: 'Notification device is no longer active.',
        });
        continue;
      }

      const actor = activityEvent ? await ctx.db.get(activityEvent.actorId) : null;
      const copy = notificationCopy({
        actorName: actor?.displayName ?? actor?.email ?? 'Jemand',
        circleName: circle?.name ?? 'deinem Circle',
        kind: attempt.kind,
      });

      batch.push({
        attemptId: attempt._id,
        deviceId: device._id,
        deviceToken: device.deviceToken,
        title: copy.title,
        body: copy.body,
        data: {
          activityEventId: attempt.activityEventId,
          ...(attempt.inboxItemId ? { inboxItemId: attempt.inboxItemId } : {}),
          kind: attempt.kind,
          shareBatchId: attempt.shareBatchId,
          ...(attempt.assetId ? { assetId: attempt.assetId } : {}),
        },
        failureReason: null,
      });
    }

    return batch;
  },
});

export const markSendResults = internalMutation({
  args: {
    now: v.number(),
    results: v.array(sendMarkResultValidator),
  },
  handler: async (ctx, args) => {
    let sent = 0;
    let failed = 0;

    for (const result of args.results) {
      const attempt = await ctx.db.get(result.attemptId);

      if (!attempt) {
        continue;
      }

      if (result.status === 'sent' && result.providerMessageId) {
        await ctx.db.patch(result.attemptId, {
          providerMessageId: result.providerMessageId,
          errorMessage: undefined,
          updatedAt: args.now,
        });
        sent += 1;
      } else {
        await ctx.db.patch(result.attemptId, {
          status: 'failed',
          errorMessage: result.errorMessage ?? 'Expo push delivery failed.',
          updatedAt: args.now,
        });
        failed += 1;
      }

      if (result.disableDevice && attempt.deviceId) {
        await ctx.db.patch(attempt.deviceId, {
          disabledAt: args.now,
          updatedAt: args.now,
        });
      }
    }

    return { sent, failed };
  },
});

export const getQueuedReceiptBatch = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<QueuedReceiptAttempt[]> => {
    const readyBefore = args.now - PUSH_RECEIPT_READY_AFTER_MS;
    const rows = await ctx.db
      .query('notificationDeliveryAttempts')
      .withIndex('by_status_and_updated_at', (q) => q.eq('status', 'queued'))
      .order('asc')
      .take(PUSH_SCAN_BATCH_SIZE);

    return rows
      .filter(
        (attempt) =>
          Boolean(attempt.providerMessageId) && attempt.updatedAt <= readyBefore,
      )
      .slice(0, Math.min(args.limit, PUSH_RECEIPT_BATCH_SIZE))
      .map((attempt) => ({
        attemptId: attempt._id,
        deviceId: attempt.deviceId ?? null,
        providerMessageId: attempt.providerMessageId ?? '',
      }));
  },
});

export const markReceiptResults = internalMutation({
  args: {
    now: v.number(),
    results: v.array(receiptMarkResultValidator),
  },
  handler: async (ctx, args) => {
    let delivered = 0;
    let failed = 0;

    for (const result of args.results) {
      const attempt = await ctx.db.get(result.attemptId);

      if (!attempt) {
        continue;
      }

      if (result.status === 'delivered') {
        await ctx.db.patch(result.attemptId, {
          status: 'delivered',
          errorMessage: undefined,
          updatedAt: args.now,
        });
        delivered += 1;
      } else {
        await ctx.db.patch(result.attemptId, {
          status: 'failed',
          errorMessage: result.errorMessage ?? 'Expo push receipt failed.',
          updatedAt: args.now,
        });
        failed += 1;
      }

      if (result.disableDevice && attempt.deviceId) {
        await ctx.db.patch(attempt.deviceId, {
          disabledAt: args.now,
          updatedAt: args.now,
        });
      }
    }

    return { delivered, failed };
  },
});

export const dispatchQueued = internalAction({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accessToken = expoPushAccessToken();

    if (!accessToken) {
      return {
        scanned: 0,
        sent: 0,
        failed: 0,
        retried: 0,
        skipped: 0,
      };
    }

    const batch: QueuedSendAttempt[] = await ctx.runQuery(
      internal.notifications.getQueuedSendBatch,
      { limit: PUSH_SEND_BATCH_SIZE },
    );
    const invalidResults: SendMarkResult[] = batch
      .filter((attempt) => !attempt.deviceToken)
      .map((attempt) => ({
        attemptId: attempt.attemptId,
        status: 'failed',
        errorMessage: attempt.failureReason ?? 'Notification device is no longer active.',
        disableDevice: Boolean(attempt.deviceId),
      }));
    const deliverable = batch.filter((attempt) => attempt.deviceToken);
    const sendResults: SendMarkResult[] = [...invalidResults];

    if (deliverable.length > 0) {
      const response = await sendExpoPushMessages(deliverable.map(toExpoMessage), accessToken);

      if (!response.ok && response.transient) {
        if (invalidResults.length > 0) {
          await ctx.runMutation(internal.notifications.markSendResults, {
            now,
            results: invalidResults,
          });
        }

        return {
          scanned: batch.length,
          sent: 0,
          failed: invalidResults.length,
          retried: deliverable.length,
          skipped: 0,
        };
      }

      if (!response.ok) {
        sendResults.push(
          ...deliverable.map((attempt) => ({
            attemptId: attempt.attemptId,
            status: 'failed' as const,
            errorMessage: response.message,
          })),
        );
      } else {
        sendResults.push(
          ...deliverable.map((attempt, index) => {
            const ticket = response.tickets[index];

            return ticket?.status === 'ok' && ticket.id
              ? {
                  attemptId: attempt.attemptId,
                  status: 'sent' as const,
                  providerMessageId: ticket.id,
                }
              : {
                  attemptId: attempt.attemptId,
                  status: 'failed' as const,
                  errorMessage: ticket ? ticketErrorMessage(ticket) : 'Expo push ticket missing.',
                  disableDevice: ticket?.details?.error === 'DeviceNotRegistered',
                };
          }),
        );
      }
    }

    if (sendResults.length > 0) {
      await ctx.runMutation(internal.notifications.markSendResults, {
        now,
        results: sendResults,
      });
    }

    return {
      scanned: batch.length,
      sent: sendResults.filter((result) => result.status === 'sent').length,
      failed: sendResults.filter((result) => result.status === 'failed').length,
      retried: 0,
      skipped: 0,
    };
  },
});

export const checkReceipts = internalAction({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accessToken = expoPushAccessToken();

    if (!accessToken) {
      return {
        scanned: 0,
        delivered: 0,
        failed: 0,
        missing: 0,
        retried: 0,
        skipped: 0,
      };
    }

    const batch: QueuedReceiptAttempt[] = await ctx.runQuery(
      internal.notifications.getQueuedReceiptBatch,
      { limit: PUSH_RECEIPT_BATCH_SIZE, now },
    );

    if (batch.length === 0) {
      return {
        scanned: 0,
        delivered: 0,
        failed: 0,
        missing: 0,
        retried: 0,
        skipped: 0,
      };
    }

    const response = await fetchExpoPushReceipts(
      batch.map((attempt) => attempt.providerMessageId),
      accessToken,
    );

    if (!response.ok && response.transient) {
      return {
        scanned: batch.length,
        delivered: 0,
        failed: 0,
        missing: 0,
        retried: batch.length,
        skipped: 0,
      };
    }

    const receiptResults: ReceiptMarkResult[] = [];
    let missing = 0;

    if (!response.ok) {
      receiptResults.push(
        ...batch.map((attempt) => ({
          attemptId: attempt.attemptId,
          status: 'failed' as const,
          errorMessage: response.message,
        })),
      );
    } else {
      for (const attempt of batch) {
        const receipt = response.receipts[attempt.providerMessageId];

        if (!receipt) {
          missing += 1;
          continue;
        }

        receiptResults.push(
          receipt.status === 'ok'
            ? {
                attemptId: attempt.attemptId,
                status: 'delivered' as const,
              }
            : {
                attemptId: attempt.attemptId,
                status: 'failed' as const,
                errorMessage: receiptErrorMessage(receipt),
                disableDevice: receipt.details?.error === 'DeviceNotRegistered',
              },
        );
      }
    }

    if (receiptResults.length > 0) {
      await ctx.runMutation(internal.notifications.markReceiptResults, {
        now,
        results: receiptResults,
      });
    }

    return {
      scanned: batch.length,
      delivered: receiptResults.filter((result) => result.status === 'delivered').length,
      failed: receiptResults.filter((result) => result.status === 'failed').length,
      missing,
      retried: 0,
      skipped: 0,
    };
  },
});
