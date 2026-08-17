import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id, TableNames } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { action, internalMutation, internalQuery } from './_generated/server';
import { adjustCircleStats } from './circleStats';
import { deleteStorageReference, storageReferenceKey } from './lib/storage/shared';
import { requireViewer } from './lib/viewer';

export const accountDeletionFunctionSurface = ['accountDeletion.deleteMyAccountData'] as const;

const ACCOUNT_DELETE_BATCH_SIZE = 100;
const MAX_ACCOUNT_DELETE_PASSES = 500;
const MAX_OWNED_CIRCLES = 100;
const AUTH_IDENTIFIER_ANONYMIZE_DELAY_MS = 10 * 60 * 1000;

type StorageRef = NonNullable<Doc<'users'>['profileImageStorage']>;

interface PurgeState {
  budget: number;
  deleted: number;
  storageRefs: StorageRef[];
}

function collectStorageRef(state: PurgeState, ref: StorageRef | undefined | null): void {
  if (ref) {
    state.storageRefs.push(ref);
  }
}

async function deleteDocs<T extends { _id: Id<TableNames> }>(
  ctx: MutationCtx,
  state: PurgeState,
  docs: T[],
): Promise<void> {
  for (const doc of docs) {
    if (state.budget <= 0) {
      return;
    }

    await ctx.db.delete(doc._id);
    state.budget -= 1;
    state.deleted += 1;
  }
}

export const prepare = internalMutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const now = Date.now();

    if (viewer.deletionRequestedAt === undefined) {
      await ctx.db.patch(viewer._id, {
        deletionRequestedAt: now,
      });
    }

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user_and_role', (q) =>
        q.eq('userId', viewer._id).eq('role', 'owner'),
      )
      .take(MAX_OWNED_CIRCLES + 1);
    const ownedCircleIds = memberships.map((membership) => membership.circleId);

    if (ownedCircleIds.length > MAX_OWNED_CIRCLES) {
      throw new Error('Account owns too many circles for automatic deletion.');
    }

    return {
      userId: viewer._id,
      ownedCircleIds,
    };
  },
});

export const nextAuthoredShare = internalQuery({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query('shareBatches')
      .withIndex('by_author', (q) => q.eq('authorId', args.userId))
      .first();

    return share?._id ?? null;
  },
});

export const purgeBatch = internalMutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const state: PurgeState = {
      budget: ACCOUNT_DELETE_BATCH_SIZE,
      deleted: 0,
      storageRefs: [],
    };
    const user = await ctx.db.get(args.userId);

    if (!user) {
      return {
        deleted: 0,
        storageRefs: [],
      };
    }

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .take(state.budget);

    for (const membership of memberships) {
      if (state.budget <= 0) {
        break;
      }

      await ctx.db.delete(membership._id);
      state.budget -= 1;
      state.deleted += 1;

      if (await ctx.db.get(membership.circleId)) {
        await adjustCircleStats(ctx, membership.circleId, { memberCount: -1 });
      }
    }

    if (state.budget > 0) {
      const comments = await ctx.db
        .query('comments')
        .withIndex('by_author', (q) => q.eq('authorId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, comments);
    }

    if (state.budget > 0) {
      const reactions = await ctx.db
        .query('reactions')
        .withIndex('by_user', (q) => q.eq('userId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, reactions);
    }

    if (state.budget > 0) {
      const events = await ctx.db
        .query('activityEvents')
        .withIndex('by_actor', (q) => q.eq('actorId', args.userId))
        .take(state.budget);

      for (const event of events) {
        if (state.budget <= 0) {
          break;
        }

        const deliveryAttempts = await ctx.db
          .query('notificationDeliveryAttempts')
          .withIndex('by_activity_event_id', (q) => q.eq('activityEventId', event._id))
          .take(state.budget);
        await deleteDocs(ctx, state, deliveryAttempts);

        if (state.budget <= 0) {
          break;
        }

        const inboxItems = await ctx.db
          .query('activityInboxItems')
          .withIndex('by_activity_event_id', (q) => q.eq('activityEventId', event._id))
          .take(state.budget);
        await deleteDocs(ctx, state, inboxItems);

        if (state.budget <= 0) {
          break;
        }

        await ctx.db.delete(event._id);
        state.budget -= 1;
        state.deleted += 1;
      }
    }

    if (state.budget > 0) {
      const receivedInboxItems = await ctx.db
        .query('activityInboxItems')
        .withIndex('by_user_and_created_at', (q) => q.eq('userId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, receivedInboxItems);
    }

    if (state.budget > 0) {
      const actorInboxItems = await ctx.db
        .query('activityInboxItems')
        .withIndex('by_actor', (q) => q.eq('actorId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, actorInboxItems);
    }

    if (state.budget > 0) {
      const deliveryAttempts = await ctx.db
        .query('notificationDeliveryAttempts')
        .withIndex('by_user_and_created_at', (q) => q.eq('userId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, deliveryAttempts);
    }

    if (state.budget > 0) {
      const devices = await ctx.db
        .query('notificationDevices')
        .withIndex('by_user', (q) => q.eq('userId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, devices);
    }

    if (state.budget > 0) {
      const preferences = await ctx.db
        .query('notificationPreferences')
        .withIndex('by_user_and_kind', (q) => q.eq('userId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, preferences);
    }

    if (state.budget > 0) {
      const sentInvites = await ctx.db
        .query('invites')
        .withIndex('by_invited_by', (q) => q.eq('invitedBy', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, sentInvites);
    }

    if (state.budget > 0) {
      const acceptedInvites = await ctx.db
        .query('invites')
        .withIndex('by_accepted_by', (q) => q.eq('acceptedBy', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, acceptedInvites);
    }

    if (state.budget > 0 && user.email) {
      const emailInvites = await ctx.db
        .query('invites')
        .withIndex('by_invited_email', (q) => q.eq('invitedEmail', user.email))
        .take(state.budget);
      await deleteDocs(ctx, state, emailInvites);
    }

    if (state.budget > 0) {
      const publicLinks = await ctx.db
        .query('publicCircleLinks')
        .withIndex('by_created_by', (q) => q.eq('createdBy', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, publicLinks);
    }

    if (state.budget > 0) {
      const uploads = await ctx.db
        .query('uploads')
        .withIndex('by_created_by', (q) => q.eq('createdBy', args.userId))
        .take(state.budget);

      for (const upload of uploads) {
        collectStorageRef(state, upload.pendingStorage);
        collectStorageRef(state, upload.previewPendingStorage);
        collectStorageRef(state, upload.storage);
        collectStorageRef(state, upload.previewStorage);
      }

      await deleteDocs(ctx, state, uploads);
    }

    if (state.budget > 0) {
      const imageUploads = await ctx.db
        .query('imageUploads')
        .withIndex('by_user', (q) => q.eq('userId', args.userId))
        .take(state.budget);

      for (const upload of imageUploads) {
        collectStorageRef(state, upload.pendingStorage);
        collectStorageRef(state, upload.storage);
      }

      await deleteDocs(ctx, state, imageUploads);
    }

    if (state.budget > 0) {
      const usageRows = await ctx.db
        .query('billingUsage')
        .withIndex('by_owner_and_period', (q) => q.eq('ownerId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, usageRows);
    }

    if (state.budget > 0) {
      const storageRows = await ctx.db
        .query('billingStorage')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, storageRows);
    }

    if (state.budget > 0) {
      const retentionRows = await ctx.db
        .query('billingRetention')
        .withIndex('by_owner', (q) => q.eq('ownerId', args.userId))
        .take(state.budget);
      await deleteDocs(ctx, state, retentionRows);
    }

    if (state.budget > 0 && user.profileImageStorage) {
      collectStorageRef(state, user.profileImageStorage);
      await ctx.db.patch(user._id, {
        profileImageStorage: undefined,
        profileImageSizeBytes: undefined,
      });
      state.budget -= 1;
      state.deleted += 1;
    }

    return {
      deleted: state.deleted,
      storageRefs: state.storageRefs,
    };
  },
});

export const complete = internalMutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user) {
      return null;
    }

    await ctx.db.patch(user._id, {
      email: undefined,
      displayName: undefined,
      avatarUrl: undefined,
      profileImageStorage: undefined,
      profileImageSizeBytes: undefined,
      deletionCompletedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      AUTH_IDENTIFIER_ANONYMIZE_DELAY_MS,
      internal.accountDeletion.anonymizeAuthIdentifiers,
      { userId: user._id },
    );

    return user._id;
  },
});

export const anonymizeAuthIdentifiers = internalMutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user?.deletionCompletedAt) {
      return null;
    }

    const deletedIdentifier = `deleted:${user._id}`;
    await ctx.db.patch(user._id, {
      tokenIdentifier: deletedIdentifier,
      authSubject: deletedIdentifier,
      email: undefined,
      displayName: undefined,
      avatarUrl: undefined,
    });

    return user._id;
  },
});

export const deleteMyAccountData = action({
  args: {},
  handler: async (ctx) => {
    const prepared: {
      userId: Id<'users'>;
      ownedCircleIds: Id<'circles'>[];
    } = await ctx.runMutation(internal.accountDeletion.prepare, {});

    for (let pass = 0; pass < MAX_ACCOUNT_DELETE_PASSES; pass += 1) {
      const shareBatchId: Id<'shareBatches'> | null = await ctx.runQuery(
        internal.accountDeletion.nextAuthoredShare,
        { userId: prepared.userId },
      );

      if (!shareBatchId) {
        break;
      }

      await ctx.runAction(internal.shares.deleteShareForAccountDeletion, {
        shareBatchId,
        userId: prepared.userId,
      });

      if (pass === MAX_ACCOUNT_DELETE_PASSES - 1) {
        throw new Error('Account has too many posts for automatic deletion.');
      }
    }

    for (const circleId of prepared.ownedCircleIds) {
      await ctx.runAction(internal.admin.deleteCircle, { circleId });
    }

    const deletedStorageRefs = new Set<string>();

    for (let pass = 0; pass < MAX_ACCOUNT_DELETE_PASSES; pass += 1) {
      const result: {
        deleted: number;
        storageRefs: StorageRef[];
      } = await ctx.runMutation(internal.accountDeletion.purgeBatch, {
        userId: prepared.userId,
      });

      for (const ref of result.storageRefs) {
        const key = storageReferenceKey(ref);

        if (deletedStorageRefs.has(key)) {
          continue;
        }

        deletedStorageRefs.add(key);

        try {
          await deleteStorageReference(ctx, ref);
        } catch (error) {
          console.error('accountDeletion: failed to delete storage object', { key, error });
        }
      }

      if (result.deleted === 0) {
        await ctx.runMutation(internal.accountDeletion.complete, {
          userId: prepared.userId,
        });

        return {
          deleted: true,
        };
      }
    }

    throw new Error('Account has too much data for automatic deletion.');
  },
});
