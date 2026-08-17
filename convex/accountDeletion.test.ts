/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import type { UserIdentity } from 'convex/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const CLERK_TEST_ISSUER = 'https://test.clerk.accounts.dev';

function clerkIdentity(email: string): Partial<UserIdentity> {
  const subject = `user_${email.replace(/[^a-z0-9]+/gi, '_')}`;

  return {
    issuer: CLERK_TEST_ISSUER,
    subject,
    tokenIdentifier: `${CLERK_TEST_ISSUER}|${subject}`,
    email,
    name: email,
  };
}

describe('account deletion', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('deletes account data, owned circles, shared-circle content, and Clerk profile fields', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(clerkIdentity('owner@example.com'));
    const deletingUser = t.withIdentity(clerkIdentity('delete@example.com'));
    const ownerViewer = await owner.mutation(api.users.upsertFromIdentity, {
      email: 'owner@example.com',
      displayName: 'Owner',
    });
    const deletingViewer = await deletingUser.mutation(api.users.upsertFromIdentity, {
      email: 'delete@example.com',
      displayName: 'Delete Me',
    });

    if (!ownerViewer || typeof ownerViewer === 'string' || !deletingViewer || typeof deletingViewer === 'string') {
      throw new Error('Expected viewer records.');
    }

    const sharedCircle = await owner.mutation(api.circles.create, { name: 'Shared' });
    const ownedCircle = await deletingUser.mutation(api.circles.create, { name: 'Owned' });
    const records = await t.run(async (ctx) => {
      const membershipId = await ctx.db.insert('circleMembers', {
        circleId: sharedCircle.circleId,
        userId: deletingViewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
      const sharedStats = await ctx.db
        .query('circleStats')
        .withIndex('by_circle', (q) => q.eq('circleId', sharedCircle.circleId))
        .unique();

      if (sharedStats) {
        await ctx.db.patch(sharedStats._id, { memberCount: 2 });
      }

      const authoredShareId = await ctx.db.insert('shareBatches', {
        circleId: sharedCircle.circleId,
        authorId: deletingViewer._id,
        caption: 'Delete this post',
        assetCount: 0,
        status: 'published',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        publishedAt: Date.now(),
      });
      const retainedShareId = await ctx.db.insert('shareBatches', {
        circleId: sharedCircle.circleId,
        authorId: ownerViewer._id,
        caption: 'Keep this post',
        assetCount: 0,
        status: 'published',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        publishedAt: Date.now(),
      });
      const commentId = await ctx.db.insert('comments', {
        shareBatchId: retainedShareId,
        circleId: sharedCircle.circleId,
        authorId: deletingViewer._id,
        targetKind: 'share',
        targetKey: `share:${retainedShareId}`,
        body: 'Delete this comment',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const reactionId = await ctx.db.insert('reactions', {
        shareBatchId: retainedShareId,
        circleId: sharedCircle.circleId,
        userId: deletingViewer._id,
        targetKind: 'share',
        targetKey: `share:${retainedShareId}`,
        emoji: '❤️',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const eventId = await ctx.db.insert('activityEvents', {
        circleId: sharedCircle.circleId,
        actorId: deletingViewer._id,
        type: 'comment.created',
        entityId: retainedShareId,
        shareBatchId: retainedShareId,
        commentId,
        createdAt: Date.now(),
      });
      const inboxItemId = await ctx.db.insert('activityInboxItems', {
        activityEventId: eventId,
        userId: ownerViewer._id,
        circleId: sharedCircle.circleId,
        actorId: deletingViewer._id,
        type: 'comment.created',
        shareBatchId: retainedShareId,
        status: 'unread',
        createdAt: Date.now(),
      });
      const deviceId = await ctx.db.insert('notificationDevices', {
        userId: deletingViewer._id,
        instanceUrl: 'https://api.example.com',
        deviceToken: 'ExponentPushToken[delete-me]',
        provider: 'expo',
        platform: 'ios',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRegisteredAt: Date.now(),
      });
      const preferenceId = await ctx.db.insert('notificationPreferences', {
        userId: deletingViewer._id,
        kind: 'comment.created',
        enabled: true,
        updatedAt: Date.now(),
      });

      return {
        membershipId,
        authoredShareId,
        retainedShareId,
        commentId,
        reactionId,
        eventId,
        inboxItemId,
        deviceId,
        preferenceId,
      };
    });

    await expect(deletingUser.action(api.accountDeletion.deleteMyAccountData, {})).resolves.toEqual({
      deleted: true,
    });

    const result = await t.run(async (ctx) => {
      const stats = await ctx.db
        .query('circleStats')
        .withIndex('by_circle', (q) => q.eq('circleId', sharedCircle.circleId))
        .unique();

      return {
        sharedCircle: await ctx.db.get(sharedCircle.circleId as Id<'circles'>),
        ownedCircle: await ctx.db.get(ownedCircle.circleId as Id<'circles'>),
        membership: await ctx.db.get(records.membershipId),
        authoredShare: await ctx.db.get(records.authoredShareId),
        retainedShare: await ctx.db.get(records.retainedShareId),
        comment: await ctx.db.get(records.commentId),
        reaction: await ctx.db.get(records.reactionId),
        event: await ctx.db.get(records.eventId),
        inboxItem: await ctx.db.get(records.inboxItemId),
        device: await ctx.db.get(records.deviceId),
        preference: await ctx.db.get(records.preferenceId),
        user: await ctx.db.get(deletingViewer._id),
        memberCount: stats?.memberCount,
      };
    });

    expect(result).toMatchObject({
      sharedCircle: { name: 'Shared' },
      ownedCircle: null,
      membership: null,
      authoredShare: null,
      retainedShare: { caption: 'Keep this post' },
      comment: null,
      reaction: null,
      event: null,
      inboxItem: null,
      device: null,
      preference: null,
      memberCount: 1,
      user: {
        deletionRequestedAt: expect.any(Number),
        deletionCompletedAt: expect.any(Number),
      },
    });
    expect(result.user).not.toHaveProperty('email');
    expect(result.user).not.toHaveProperty('displayName');

    const blockedUpsert = await deletingUser.mutation(api.users.upsertFromIdentity, {
        email: 'delete@example.com',
        displayName: 'Restored name',
      });
    expect(blockedUpsert).toMatchObject({
      deletionRequestedAt: expect.any(Number),
    });
    expect(blockedUpsert).not.toHaveProperty('email');
    expect(blockedUpsert).not.toHaveProperty('displayName');

    await deletingUser.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.run(async (ctx) => await ctx.db.get(deletingViewer._id))).resolves.toMatchObject({
      tokenIdentifier: `deleted:${deletingViewer._id}`,
      authSubject: `deleted:${deletingViewer._id}`,
    });
  });
});
