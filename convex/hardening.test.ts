/// <reference types="vite/client" />

import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference, type UserIdentity } from 'convex/server';
import { describe, expect, test, vi } from 'vitest';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { activityFunctionSurface } from './activity';
import { assetFunctionSurface } from './assets';
import { autumnFunctionSurface } from './autumn';
import { billingFunctionSurface } from './billing';
import { commentFunctionSurface } from './comments';
import { httpSurface } from './http';
import { billingBackendKind } from './lib/billing/autumn';
import {
  appendParamsToUrl,
  buildCallbackUrlFromEnv,
  buildPublicInstanceConfigFromEnv,
  normalizeWorkOSHttpSessionPayload,
} from './lib/httpHelpers';
import {
  BETA_MAX_VIDEO_DURATION_SECONDS,
  DEFAULT_CLOUD_BILLING_PLANS,
  getDeploymentPolicyFromEnv,
} from './lib/instance';
import { verifyS3ObjectExists } from './lib/storage/s3';
import { BETA_MAX_MEDIA_SELECTION_COUNT } from './lib/uploadLimits';
import { reactionFunctionSurface } from './reactions';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const EXPECTED_CIRCLE_INVITE_LIST_LIMIT = 100;
const EXPECTED_CIRCLE_MEMBER_LIST_LIMIT = 200;
const EXPECTED_STORAGE_STATS_CIRCLE_LIMIT = 100;
const EXPECTED_SHARE_ASSET_DISPLAY_LIMIT = 100;
const EXPECTED_ASSET_LINKED_UPLOAD_DELETE_LIMIT = 20;
const EXPECTED_SHARE_DELETE_BATCH_SIZE = 50;
const COMMENT_MAX_BODY_LENGTH = 1000;

const commentsApi = {
  listForShare: makeFunctionReference<
    'query',
    {
      shareBatchId: Id<'shareBatches'>;
      assetId?: Id<'assets'>;
      paginationOpts: { numItems: number; cursor: string | null };
    },
    {
      page: Array<{
        _id: Id<'comments'>;
        body: string;
        targetKind: 'share' | 'asset';
        assetId: Id<'assets'> | null;
        authorId: Id<'users'>;
        authorName: string;
        canDelete: boolean;
      }>;
      isDone: boolean;
      continueCursor: string;
    }
  >('comments:listForShare'),
  create: makeFunctionReference<
    'mutation',
    { shareBatchId: Id<'shareBatches'>; assetId?: Id<'assets'>; body: string },
    { commentId: Id<'comments'> }
  >('comments:create'),
  delete: makeFunctionReference<
    'mutation',
    { commentId: Id<'comments'> },
    { commentId: Id<'comments'> }
  >('comments:delete'),
};

const reactionsApi = {
  listForShare: makeFunctionReference<
    'query',
    { shareBatchId: Id<'shareBatches'> },
    {
      targets: Array<{
        targetKind: 'share' | 'asset';
        assetId: Id<'assets'> | null;
        reactionCount: number;
        viewerReaction: string | null;
        topReactions: Array<{
          emoji: string;
          count: number;
          reactedByViewer: boolean;
        }>;
      }>;
    }
  >('reactions:listForShare'),
  set: makeFunctionReference<
    'mutation',
    { shareBatchId: Id<'shareBatches'>; assetId?: Id<'assets'>; emoji: string },
    { reactionId: Id<'reactions'>; emoji: string }
  >('reactions:set'),
  remove: makeFunctionReference<
    'mutation',
    { shareBatchId: Id<'shareBatches'>; assetId?: Id<'assets'> },
    { removed: boolean }
  >('reactions:remove'),
};

const activityApi = {
  listForViewer: makeFunctionReference<
    'query',
    {
      paginationOpts: { numItems: number; cursor: string | null };
    },
    {
      page: Array<{
        _id: Id<'activityEvents'>;
        circleId: Id<'circles'>;
        circleName: string;
        actorId: Id<'users'>;
        actorName: string;
        type: string;
        shareBatchId: Id<'shareBatches'>;
        assetId: Id<'assets'> | null;
        displayText: string;
        createdAt: number;
      }>;
      isDone: boolean;
      continueCursor: string;
    }
  >('activity:listForViewer'),
  summaryForViewer: makeFunctionReference<
    'query',
    Record<string, never>,
    {
      unreadCount: number;
      hasUnread: boolean;
    }
  >('activity:summaryForViewer'),
  listInboxForViewer: makeFunctionReference<
    'query',
    {
      paginationOpts: { numItems: number; cursor: string | null };
    },
    {
      page: Array<{
        _id: string;
        activityEventId: Id<'activityEvents'>;
        circleId: Id<'circles'>;
        actorId: Id<'users'>;
        type: string;
        shareBatchId: Id<'shareBatches'>;
        assetId: Id<'assets'> | null;
        status: 'unread' | 'read';
        displayText: string;
        createdAt: number;
      }>;
      isDone: boolean;
      continueCursor: string;
    }
  >('activity:listInboxForViewer'),
  markRead: makeFunctionReference<
    'mutation',
    { inboxItemId: string },
    { inboxItemId: string; status: 'read' }
  >('activity:markRead'),
  markManyRead: makeFunctionReference<
    'mutation',
    { inboxItemIds: string[] },
    { readCount: number }
  >('activity:markManyRead'),
};

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

function createTestDb() {
  return convexTest(schema, modules);
}

async function withDeploymentKind<T>(
  deploymentKind: 'cloud' | 'self-hosted',
  run: () => Promise<T>,
): Promise<T> {
  const originalPublicDeploymentKind = process.env.PUBLIC_DEPLOYMENT_KIND;
  process.env.PUBLIC_DEPLOYMENT_KIND = deploymentKind;

  try {
    return await run();
  } finally {
    if (originalPublicDeploymentKind === undefined) {
      delete process.env.PUBLIC_DEPLOYMENT_KIND;
    } else {
      process.env.PUBLIC_DEPLOYMENT_KIND = originalPublicDeploymentKind;
    }
  }
}

async function withS3SigningEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalAccessKeyId = process.env.S3_ACCESS_KEY_ID;
  const originalSecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

  try {
    return await run();
  } finally {
    if (originalAccessKeyId === undefined) {
      delete process.env.S3_ACCESS_KEY_ID;
    } else {
      process.env.S3_ACCESS_KEY_ID = originalAccessKeyId;
    }

    if (originalSecretAccessKey === undefined) {
      delete process.env.S3_SECRET_ACCESS_KEY;
    } else {
      process.env.S3_SECRET_ACCESS_KEY = originalSecretAccessKey;
    }
  }
}

function workosIdentity(email: string, name = email): Partial<UserIdentity> {
  return {
    issuer: 'https://api.workos.com/user_management/client_test',
    subject: `user_${email.replace(/[^a-z0-9]+/gi, '_')}`,
    tokenIdentifier: `workos|${email.toLowerCase()}`,
    email,
    name,
  };
}

async function upsertViewer(
  t: TestDb,
  email: string,
  displayName = email,
): Promise<{
  user: TestUser;
  viewer: Doc<'users'>;
}> {
  const user = t.withIdentity(workosIdentity(email, displayName));
  const result = await user.mutation(api.users.upsertFromIdentity, {
    email,
    displayName,
  });

  if (typeof result !== 'object' || result === null || !('_id' in result)) {
    throw new Error('Expected upsertFromIdentity to return a viewer record.');
  }

  return {
    user,
    viewer: result as Doc<'users'>,
  };
}

async function createCircleFor(
  t: TestDb,
  email: string,
  name = 'Family',
): Promise<{
  user: TestUser;
  viewer: Doc<'users'>;
  circleId: Id<'circles'>;
}> {
  const { user, viewer } = await upsertViewer(t, email, email);
  const created = await user.mutation(api.circles.create, {
    name,
    description: 'Private circle',
  });

  return {
    user,
    viewer,
    circleId: created.circleId as Id<'circles'>,
  };
}

async function getCircleStats(t: TestDb, circleId: Id<'circles'>) {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => { unique: () => Promise<unknown> };
      };
    };

    return await db
      .query('circleStats')
      .withIndex('by_circle', (q) => q.eq('circleId', circleId))
      .unique();
  });
}

async function listActivityEventsForEntity(
  t: TestDb,
  circleId: Id<'circles'>,
  entityId: string,
) {
  return await t.run(async (ctx) => {
    const events = [];

    for await (const event of ctx.db
      .query('activityEvents')
      .withIndex('by_circle', (q) => q.eq('circleId', circleId))) {
      if (event.entityId === entityId) {
        events.push(event);
      }
    }

    return events;
  });
}

async function countShareChildren(t: TestDb, shareBatchId: Id<'shareBatches'>) {
  return await t.run(async (ctx) => {
    let assetCount = 0;
    let uploadCount = 0;

    for await (const asset of ctx.db
      .query('assets')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))) {
      void asset;
      assetCount += 1;
    }

    for await (const upload of ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))) {
      void upload;
      uploadCount += 1;
    }

    return { assetCount, uploadCount };
  });
}

async function countUploadsForShareBatch(t: TestDb, shareBatchId: Id<'shareBatches'>) {
  return await t.run(async (ctx) => {
    let count = 0;

    for await (const upload of ctx.db
      .query('uploads')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))) {
      void upload;
      count += 1;
    }

    return count;
  });
}

async function createLegacyInvite(input: {
  t: TestDb;
  circleId: Id<'circles'>;
  invitedBy: Id<'users'>;
  invitedEmail: string;
  token: string;
}) {
  return await input.t.run(async (ctx) => {
    return await ctx.db.insert('invites', {
      circleId: input.circleId,
      invitedEmail: input.invitedEmail,
      role: 'member',
      tokenHash: input.token,
      status: 'pending',
      invitedBy: input.invitedBy,
      expiresAt: Date.now() + 60_000,
    });
  });
}

async function createUploadedDraftAsset(input: {
  t: TestDb;
  user: TestUser;
  viewerId: Id<'users'>;
  circleId: Id<'circles'>;
  kind?: 'image' | 'video';
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}) {
  const kind = input.kind ?? 'image';
  const fileName = input.fileName ?? (kind === 'image' ? 'photo.jpg' : 'clip.mp4');
  const mimeType = input.mimeType ?? (kind === 'image' ? 'image/jpeg' : 'video/mp4');
  const draft = await input.user.mutation(api.shares.getOrCreateDraft, {
    circleId: input.circleId,
  });
  const storageId = await input.t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['media'], { type: mimeType }));
  });
  const uploadId = await input.t.run(async (ctx) => {
    return await ctx.db.insert('uploads', {
      shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
      circleId: input.circleId,
      createdBy: input.viewerId,
      providerKind: 'convex-files',
      kind,
      fileName,
      mimeType,
      status: 'uploading',
      createdAt: Date.now(),
    });
  });
  const completed = await input.user.mutation(internal.uploads.finalizeComplete, {
    uploadId,
    storageId,
    fileName,
    sizeBytes: input.sizeBytes ?? 2048,
  });

  return {
    shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
    uploadId,
    assetId: completed.assetId as Id<'assets'>,
  };
}

async function createPublishedShare(input: {
  t: TestDb;
  user: TestUser;
  viewerId: Id<'users'>;
  circleId: Id<'circles'>;
  fileName?: string;
  caption?: string;
}) {
  const uploaded = await createUploadedDraftAsset({
    t: input.t,
    user: input.user,
    viewerId: input.viewerId,
    circleId: input.circleId,
    fileName: input.fileName,
  });

  await input.user.mutation(api.shares.publish, {
    shareBatchId: uploaded.shareBatchId,
    ...(input.caption ? { caption: input.caption } : {}),
  });

  return uploaded;
}

async function countEngagementRows(input: {
  t: TestDb;
  shareBatchId: Id<'shareBatches'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => AsyncIterable<unknown>;
      };
    };
    let comments = 0;
    let reactions = 0;

    for await (const comment of db
      .query('comments')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))) {
      void comment;
      comments += 1;
    }

    for await (const reaction of db
      .query('reactions')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))) {
      void reaction;
      reactions += 1;
    }

    return { comments, reactions };
  });
}

async function countActivityInboxRows(input: {
  t: TestDb;
  shareBatchId: Id<'shareBatches'>;
}) {
  return await input.t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query: (tableName: string) => {
        withIndex: (
          indexName: string,
          range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => AsyncIterable<unknown>;
      };
    };
    let rows = 0;

    for await (const item of db
      .query('activityInboxItems')
      .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))) {
      void item;
      rows += 1;
    }

    return rows;
  });
}

describe('http surface', () => {
  test('exposes public instance discovery for custom backend links', () => {
    expect(httpSurface).toContain('instance.discovery');
  });

  test('builds cloud and self-hosted public instance manifests from env', () => {
    expect(
      buildPublicInstanceConfigFromEnv({
        PUBLIC_INSTANCE_BASE_URL: 'https://cloud.example.com/',
        PUBLIC_CONVEX_URL: 'https://cloud.convex.cloud/',
        PUBLIC_AUTH_MODE: 'native-client',
        PUBLIC_AUTH_CLIENT_ID: 'client_123',
        PUBLIC_DEPLOYMENT_KIND: 'cloud',
        PUBLIC_MINIMUM_APP_VERSION: '0.2.0',
      }),
    ).toMatchObject({
      instance: {
        baseUrl: 'https://cloud.example.com',
      },
      backend: {
        convexUrl: 'https://cloud.convex.cloud',
      },
      auth: {
        mode: 'native-client',
        publicConfig: {
          clientId: 'client_123',
        },
      },
      deployment: {
        kind: 'cloud',
      },
      billing: {
        enabled: true,
        provider: 'autumn',
      },
      client: {
        minimumAppVersion: '0.2.0',
      },
    });

    expect(
      buildPublicInstanceConfigFromEnv({
        PUBLIC_INSTANCE_BASE_URL: 'https://home.example.com',
        PUBLIC_CONVEX_URL: 'https://home.convex.cloud',
        PUBLIC_AUTH_MODE: 'hosted-browser',
        PUBLIC_AUTH_SIGN_IN_URL: 'https://home.example.com/auth/sign-in',
        PUBLIC_DEPLOYMENT_KIND: 'self-hosted',
      }),
    ).toMatchObject({
      auth: {
        mode: 'hosted-browser',
        publicConfig: {
          signInUrl: 'https://home.example.com/auth/sign-in',
        },
      },
      deployment: {
        kind: 'self-hosted',
      },
      billing: {
        enabled: false,
      },
    });
  });

  test('normalizes WorkOS HTTP responses and callback redirect parameters', () => {
    expect(buildCallbackUrlFromEnv({ PUBLIC_INSTANCE_BASE_URL: 'https://cloud.example.com/' })).toBe(
      'https://cloud.example.com/auth/callback',
    );
    expect(
      appendParamsToUrl('beisammen://auth/callback?existing=1', {
        state: 'abc',
        access_token: 'token',
      }),
    ).toBe('beisammen://auth/callback?existing=1&state=abc&access_token=token');
    expect(
      normalizeWorkOSHttpSessionPayload({
        access_token: 'access',
        refresh_token: 'refresh',
        user: {
          id: 'user_123',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          profile_picture_url: 'https://example.com/avatar.jpg',
        },
      }),
    ).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      subject: 'user_123',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      displayName: 'Ada Lovelace',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
  });
});

describe('deployment billing policy', () => {
  test('defaults to a cloud deployment with Autumn billing and finite cloud limits', () => {
    expect(getDeploymentPolicyFromEnv({})).toEqual({
      kind: 'cloud',
      isCloud: true,
      isSelfHosted: false,
      billing: {
        enabled: true,
        provider: 'autumn',
      },
      limits: {
        mediaSelectionCount: BETA_MAX_MEDIA_SELECTION_COUNT,
        videoDurationSeconds: BETA_MAX_VIDEO_DURATION_SECONDS,
      },
    });
  });

  test('self-hosted deployments disable billing and app limits', () => {
    expect(getDeploymentPolicyFromEnv({ PUBLIC_DEPLOYMENT_KIND: 'self-hosted' })).toEqual({
      kind: 'self-hosted',
      isCloud: false,
      isSelfHosted: true,
      billing: {
        enabled: false,
      },
      limits: {
        mediaSelectionCount: null,
        videoDurationSeconds: null,
      },
    });
  });

  test('exposes billing functions for cloud plan and portal flows', () => {
    expect(billingFunctionSurface).toEqual([
      'billing.status',
      'billing.statusForCircle',
      'billing.createCheckout',
      'billing.createPortalSession',
    ]);
  });

  test('exposes only the intended public asset functions', () => {
    expect(assetFunctionSurface).toEqual([
      'assets.getReadUrl',
      'assets.listForShareBatch',
      'assets.deleteDraftAsset',
    ]);
  });

  test('exposes only the intended public engagement functions', () => {
    expect(activityFunctionSurface).toEqual([
      'activity.listForViewer',
      'activity.summaryForViewer',
      'activity.listInboxForViewer',
      'activity.markRead',
      'activity.markManyRead',
    ]);
    expect(commentFunctionSurface).toEqual([
      'comments.listForShare',
      'comments.create',
      'comments.delete',
    ]);
    expect(reactionFunctionSurface).toEqual([
      'reactions.listForShare',
      'reactions.set',
      'reactions.remove',
    ]);
  });

  test('default cloud billing plans are paid-only', () => {
    expect(DEFAULT_CLOUD_BILLING_PLANS.map((plan) => plan.id)).toEqual([
      'cloud_family',
      'cloud_archive',
    ]);
    expect(
      DEFAULT_CLOUD_BILLING_PLANS.some((plan) =>
        `${plan.id} ${plan.name} ${plan.monthlyPriceLabel ?? ''}`
          .toLowerCase()
          .includes('free'),
      ),
    ).toBe(false);
  });

  test('uses the official Autumn Convex component facade', () => {
    expect(autumnFunctionSurface).toEqual([
      'autumn.track',
      'autumn.check',
      'autumn.checkout',
      'autumn.billingPortal',
      'autumn.query',
    ]);
    expect(billingBackendKind).toBe('convex-component');
  });
});

describe('viewer bootstrap', () => {
  test('upsertFromIdentity returns a serialized viewer record for new and existing users', async () => {
    const t = createTestDb();
    const user = t.withIdentity(workosIdentity('ada@example.com', 'Ada'));

    const created = await user.mutation(api.users.upsertFromIdentity, {
      email: 'ada@example.com',
      displayName: 'Ada',
    });

    expect(created).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada',
      authProvider: 'workos',
      hasProfileImage: false,
    });
    expect(typeof created).toBe('object');

    const updated = await user.mutation(api.users.upsertFromIdentity, {
      displayName: 'Ada Lovelace',
    });

    expect(updated).toMatchObject({
      _id: (created as { _id: string })._id,
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
  });
});

describe('invites', () => {
  test('new invites store hashed tokens and raw legacy tokens still resolve', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    const created = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'friend@example.com',
      role: 'member',
    });
    const stored = await t.run(async (ctx) => await ctx.db.get(created.inviteId));

    expect(stored?.tokenHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toBe(created.token);

    const invitee = await upsertViewer(t, 'friend@example.com', 'Friend');
    await createLegacyInvite({
      t,
      circleId: owner.circleId,
      invitedBy: owner.viewer._id,
      invitedEmail: 'friend@example.com',
      token: 'legacy-token',
    });

    await expect(
      invitee.user.query(api.invites.preview, { token: created.token }),
    ).resolves.toMatchObject({
      circleId: owner.circleId,
      canAccept: true,
      emailMatchesViewer: true,
    });
    await expect(
      invitee.user.query(api.invites.preview, { token: 'legacy-token' }),
    ).resolves.toMatchObject({
      circleId: owner.circleId,
      canAccept: true,
      emailMatchesViewer: true,
    });
  });

  test('accept enforces pending status, expiry, and matching viewer email', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const mismatch = await upsertViewer(t, 'wrong@example.com', 'Wrong Account');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'target@example.com',
      role: 'member',
    });

    await expect(
      mismatch.user.query(api.invites.preview, { token: invite.token }),
    ).resolves.toMatchObject({
      canAccept: false,
      emailMatchesViewer: false,
    });
    await expect(mismatch.user.mutation(api.invites.accept, { token: invite.token })).rejects.toThrow(
      /email/i,
    );

    const target = await upsertViewer(t, 'target@example.com', 'Target');
    await t.run(async (ctx) => {
      const stored = await ctx.db.get(invite.inviteId);
      if (!stored) {
        throw new Error('invite missing');
      }
      await ctx.db.patch(stored._id, {
        expiresAt: Date.now() - 1,
      });
    });

    await expect(
      target.user.query(api.invites.preview, { token: invite.token }),
    ).resolves.toMatchObject({
      status: 'expired',
      canAccept: false,
    });
    await expect(target.user.mutation(api.invites.accept, { token: invite.token })).rejects.toThrow(
      /expired/i,
    );
  });

  test('circle invite list is bounded to the newest expiring invites', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const totalInvites = EXPECTED_CIRCLE_INVITE_LIST_LIMIT + 5;
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let index = 0; index < totalInvites; index++) {
        await ctx.db.insert('invites', {
          circleId: owner.circleId,
          invitedEmail: `invite-${index}@example.com`,
          role: 'member',
          tokenHash: `sha256:${String(index).padStart(64, '0')}`,
          status: 'pending',
          invitedBy: owner.viewer._id,
          expiresAt: now + index,
        });
      }
    });

    const invites = await owner.user.query(api.invites.listForCircle, {
      circleId: owner.circleId,
    });

    expect(invites).toHaveLength(EXPECTED_CIRCLE_INVITE_LIST_LIMIT);
    expect(invites[0]?.invitedEmail).toBe(`invite-${totalInvites - 1}@example.com`);
    expect(invites[invites.length - 1]?.invitedEmail).toBe(
      `invite-${totalInvites - EXPECTED_CIRCLE_INVITE_LIST_LIMIT}@example.com`,
    );
    expect(invites.some((invite) => invite.invitedEmail === 'invite-0@example.com')).toBe(false);
  });
});

describe('circle authorization and stats', () => {
  test('new circles store their owner as billing owner', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    const stored = await t.run(async (ctx) => await ctx.db.get(owner.circleId));

    expect(stored?.billingOwnerId).toBe(owner.viewer._id);
  });

  test('ownership transfer moves the billing owner', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const target = await upsertViewer(t, 'next-owner@example.com', 'Next Owner');
    const memberId = await t.run(async (ctx) => {
      return await ctx.db.insert('circleMembers', {
        circleId: owner.circleId,
        userId: target.viewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
    });

    await owner.user.mutation(api.circles.transferOwnership, {
      circleId: owner.circleId,
      targetMemberId: memberId,
    });

    const stored = await t.run(async (ctx) => await ctx.db.get(owner.circleId));

    expect(stored?.billingOwnerId).toBe(target.viewer._id);
  });

  test('circle billing context charges the owner for member usage', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const member = await upsertViewer(t, 'member@example.com', 'Member');

    await t.run(async (ctx) => {
      await ctx.db.insert('circleMembers', {
        circleId: owner.circleId,
        userId: member.viewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
    });

    const context = await member.user.query(internal.billing.getCircleOwnerForBilling, {
      circleId: owner.circleId,
    });

    expect(context.billingOwner._id).toBe(owner.viewer._id);
    expect(context.viewerId).toBe(member.viewer._id);
    expect(context.entityId).toBe(owner.circleId);
  });

  test('circle image upload authorization returns the circle billing owner', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    const context = await owner.user.query(internal.circles.authorizeImageUpload, {
      circleId: owner.circleId,
    });

    expect(context.billingOwner._id).toBe(owner.viewer._id);
    expect(context.circleId).toBe(owner.circleId);
  });

  test('circle billing status is visible only to the billing owner', async () => {
    await withDeploymentKind('cloud', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const member = await upsertViewer(t, 'member@example.com', 'Member');

      await t.run(async (ctx) => {
        await ctx.db.insert('circleMembers', {
          circleId: owner.circleId,
          userId: member.viewer._id,
          role: 'member',
          joinedAt: Date.now(),
        });
      });

      await expect(
        member.user.action(api.billing.statusForCircle, {
          circleId: owner.circleId,
        }),
      ).rejects.toThrow(/billing owner/i);
      await expect(
        owner.user.action(api.billing.statusForCircle, {
          circleId: owner.circleId,
        }),
      ).resolves.toMatchObject({
        deployment: 'cloud',
        billing: {
          customerId: owner.viewer._id,
        },
      });
    });
  });

  test('circle stats track member count through create, accept, remove, and leave', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      circleId: owner.circleId,
      memberCount: 1,
      imageCount: 0,
      videoCount: 0,
      totalSizeBytes: 0,
    });

    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'admin@example.com',
      role: 'admin',
    });
    const admin = await upsertViewer(t, 'admin@example.com', 'Admin');
    await admin.user.mutation(api.invites.accept, { token: invite.token });

    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 2,
    });

    const membersAfterAccept = await owner.user.query(api.circles.listMembers, {
      circleId: owner.circleId,
    });
    const adminMembership = membersAfterAccept.find((member) => member.userId === admin.viewer._id);
    expect(adminMembership).toBeDefined();

    await owner.user.mutation(api.circles.removeMember, {
      circleId: owner.circleId,
      memberId: adminMembership!._id as Id<'circleMembers'>,
    });
    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 1,
    });

    const memberInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: memberInvite.token });
    await member.user.mutation(api.circles.leave, { circleId: owner.circleId });

    await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
      memberCount: 1,
    });
  });

  test('circle member list is bounded for large circles', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const extraMembers = EXPECTED_CIRCLE_MEMBER_LIST_LIMIT + 5;
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let index = 0; index < extraMembers; index++) {
        const userId = await ctx.db.insert('users', {
          tokenIdentifier: `workos|member-${index}@example.com`,
          authProvider: 'workos',
          authSubject: `member-${index}`,
          email: `member-${index}@example.com`,
          displayName: `Member ${String(index).padStart(3, '0')}`,
          createdAt: now + index,
        });

        await ctx.db.insert('circleMembers', {
          circleId: owner.circleId,
          userId,
          role: 'member',
          joinedAt: now + index,
        });
      }
    });

    const members = await owner.user.query(api.circles.listMembers, {
      circleId: owner.circleId,
    });

    expect(members).toHaveLength(EXPECTED_CIRCLE_MEMBER_LIST_LIMIT);
    expect(members.some((member) => member.userId === owner.viewer._id)).toBe(true);
    expect(
      members.some((member) => member.email === `member-${extraMembers - 1}@example.com`),
    ).toBe(false);
  });

  test('members cannot perform admin-only circle operations', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });

    await expect(
      member.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'other@example.com',
        role: 'member',
      }),
    ).rejects.toThrow(/invite/i);
    await expect(
      member.user.mutation(api.circles.update, {
        circleId: owner.circleId,
        name: 'Renamed',
      }),
    ).rejects.toThrow(/edit/i);
    await expect(
      member.user.action(api.circles.createImageTarget, {
        circleId: owner.circleId,
        mimeType: 'image/jpeg',
        fileName: 'circle.jpg',
      }),
    ).rejects.toThrow(/update the circle image/i);
  });

  test('viewer circle list is paginated and storage stats are bounded', async () => {
    const t = createTestDb();
    const { user, viewer } = await upsertViewer(t, 'collector@example.com', 'Collector');
    const circleIds: Id<'circles'>[] = [];

    for (let index = 0; index < 105; index++) {
      const created = await user.mutation(api.circles.create, {
        name: `Circle ${index.toString().padStart(3, '0')}`,
      });
      circleIds.push(created.circleId as Id<'circles'>);
    }

    const lastCircleId = circleIds[circleIds.length - 1]!;
    await createUploadedDraftAsset({
      t,
      user,
      viewerId: viewer._id,
      circleId: lastCircleId,
      sizeBytes: 1234,
    });

    const firstPage = await user.query(api.circles.listForViewer, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.page[0]?._id).toBe(lastCircleId);

    const secondPage = await user.query(api.circles.listForViewer, {
      paginationOpts: { numItems: 20, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page).toHaveLength(20);
    expect(secondPage.page.some((circle) => circle._id === lastCircleId)).toBe(false);

    await expect(user.query(api.storageStats.forViewer, {})).resolves.toEqual({
      imageCount: 1,
      videoCount: 0,
      totalSizeBytes: 1234,
      circleCount: EXPECTED_STORAGE_STATS_CIRCLE_LIMIT,
      isTruncated: true,
    });
  });

  test('authenticated storage connection check reports missing S3 configuration', async () => {
    const originalBucket = process.env.S3_BUCKET;
    delete process.env.S3_BUCKET;

    try {
      const t = createTestDb();
      const { user } = await upsertViewer(t, 'storage@example.com', 'Storage Tester');

      await expect(user.action(api.storageStats.checkConnection, {})).resolves.toMatchObject({
        ok: false,
        message: expect.stringMatching(/S3_BUCKET|S3/i),
      });
    } finally {
      if (originalBucket === undefined) {
        delete process.env.S3_BUCKET;
      } else {
        process.env.S3_BUCKET = originalBucket;
      }
    }
  });
});

describe('shares, uploads, and feed', () => {
  test('S3 verification returns the server-observed object size', async () => {
    await withS3SigningEnv(async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: {
              'content-length': '4096',
            },
          }),
        );

      try {
        await expect(
          verifyS3ObjectExists({
            storage: {
              provider: 's3',
              bucket: 'media-bucket',
              region: 'us-east-1',
              objectKey: 'circles/circle-1/share-1/photo.jpg',
            },
          }),
        ).resolves.toEqual({
          sizeBytes: 4096,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  test('upload target authorization bills the circle owner for member uploads', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const member = await upsertViewer(t, 'member@example.com', 'Member');

    await t.run(async (ctx) => {
      await ctx.db.insert('circleMembers', {
        circleId: owner.circleId,
        userId: member.viewer._id,
        role: 'member',
        joinedAt: Date.now(),
      });
    });
    const draft = await member.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });

    const context = await member.user.query(internal.uploads.authorizeCreateTarget, {
      circleId: owner.circleId,
      shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
      mimeType: 'image/jpeg',
      kind: 'image',
      fileName: 'photo.jpg',
    });

    expect(context.billingOwner._id).toBe(owner.viewer._id);
    expect(context.circleId).toBe(owner.circleId);
    expect(context.shareBatchId).toBe(draft.shareBatchId);
  });

  test('asset read urls can explicitly return preview or original storage', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const originalStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['original'], { type: 'image/jpeg' }));
    });
    const previewStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['preview'], { type: 'image/jpeg' }));
    });
    const assetId = await t.run(async (ctx) => {
      return await ctx.db.insert('assets', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        kind: 'image',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId: originalStorageId,
        },
        previewStorage: {
          provider: 'convex-files',
          storageId: previewStorageId,
        },
        createdAt: Date.now(),
      });
    });
    const expectedOriginalUrl = await t.run(async (ctx) => {
      return await ctx.storage.getUrl(originalStorageId);
    });
    const expectedPreviewUrl = await t.run(async (ctx) => {
      return await ctx.storage.getUrl(previewStorageId);
    });

    await expect(
      owner.user.action(api.assets.getReadUrl, {
        assetId,
        variant: 'original',
      }),
    ).resolves.toMatchObject({
      url: expectedOriginalUrl,
    });
    await expect(
      owner.user.action(api.assets.getReadUrl, {
        assetId,
        variant: 'preview',
      }),
    ).resolves.toMatchObject({
      url: expectedPreviewUrl,
    });
  });

  test('upload completion stores optional preview storage on the created asset', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const originalStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['original'], { type: 'video/mp4' }));
    });
    const previewStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['preview'], { type: 'image/jpeg' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'video',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    const completed = await owner.user.mutation(internal.uploads.finalizeComplete, {
      uploadId,
      storageId: originalStorageId,
      previewStorageId,
      fileName: 'clip.mp4',
      sizeBytes: 8192,
      durationSeconds: 12,
    });
    const storedAsset = await t.run(async (ctx) => {
      return await ctx.db.get(completed.assetId as Id<'assets'>);
    });

    expect(storedAsset).toMatchObject({
      kind: 'video',
      storage: {
        provider: 'convex-files',
        storageId: originalStorageId,
      },
      previewStorage: {
        provider: 'convex-files',
        storageId: previewStorageId,
      },
    });
  });

  test('draft asset metadata and read urls stay private to the draft author until published', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'private-draft.jpg',
      sizeBytes: 2048,
    });

    await expect(
      member.user.query(api.assets.listForShareBatch, {
        shareBatchId: uploaded.shareBatchId,
      }),
    ).rejects.toThrow(/draft/i);
    await expect(
      member.user.action(api.assets.getReadUrl, {
        assetId: uploaded.assetId,
        variant: 'original',
      }),
    ).rejects.toThrow(/draft/i);

    await owner.user.mutation(api.shares.publish, {
      shareBatchId: uploaded.shareBatchId,
    });

    await expect(
      member.user.query(api.assets.listForShareBatch, {
        shareBatchId: uploaded.shareBatchId,
      }),
    ).resolves.toHaveLength(1);

    const readUrl = await member.user.action(api.assets.getReadUrl, {
      assetId: uploaded.assetId,
      variant: 'original',
    });

    expect(readUrl.url).toEqual(expect.any(String));
  });

  test('standalone asset listing is bounded to the private beta media cap', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < BETA_MAX_MEDIA_SELECTION_COUNT + 2; index++) {
        await ctx.db.insert('assets', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          kind: 'image',
          fileName: `legacy-${index}.jpg`,
          mimeType: 'image/jpeg',
          storage: {
            provider: 'convex-files',
            storageId,
          },
          createdAt: Date.now() + index,
        });
      }
    });

    const assets = await owner.user.query(api.assets.listForShareBatch, {
      shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
    });

    expect(assets).toHaveLength(BETA_MAX_MEDIA_SELECTION_COUNT);
  });

  test('self-hosted standalone asset listing is bounded for large shares', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
        circleId: owner.circleId,
      });
      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' }));
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < EXPECTED_SHARE_ASSET_DISPLAY_LIMIT + 5; index++) {
          await ctx.db.insert('assets', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `self-hosted-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: Date.now() + index,
          });
        }
      });

      const assets = await owner.user.query(api.assets.listForShareBatch, {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
      });

      expect(assets).toHaveLength(EXPECTED_SHARE_ASSET_DISPLAY_LIMIT);
    });
  });

  test('only the draft author can finalize an upload into a share batch', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      member.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        storageId,
        fileName: 'photo.jpg',
        sizeBytes: 2048,
      }),
    ).rejects.toThrow(/draft author/i);
  });

  test('uploads cannot be finalized after the draft is published', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const existing = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['late'], { type: 'image/jpeg' }));
    });

    await owner.user.mutation(api.shares.publish, {
      shareBatchId: existing.shareBatchId,
    });

    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: existing.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'late.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        storageId,
        fileName: 'late.jpg',
        sizeBytes: 2048,
      }),
    ).rejects.toThrow(/draft/i);
  });

  test('upload finalization rejects an eleventh draft asset', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    let shareBatchId: Id<'shareBatches'> | null = null;

    for (let index = 0; index < 10; index++) {
      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: `photo-${index}.jpg`,
      });
      shareBatchId = uploaded.shareBatchId;
    }

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['extra'], { type: 'image/jpeg' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: shareBatchId!,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'too-many.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        storageId,
        fileName: 'too-many.jpg',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(/10 media/i);
  });

  test('upload finalization rejects unsupported image MIME metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['gif'], { type: 'image/gif' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'animated.gif',
        mimeType: 'image/gif',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        storageId,
        fileName: 'animated.gif',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(/file type/i);
  });

  test('upload finalization accepts large original media metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['large'], { type: 'image/jpeg' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'large.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    const completed = await owner.user.mutation(internal.uploads.finalizeComplete, {
      uploadId,
      storageId,
      fileName: 'large.jpg',
      sizeBytes: 512 * 1024 * 1024,
    });
    const storedAsset = await t.run(async (ctx) => {
      return await ctx.db.get(completed.assetId as Id<'assets'>);
    });

    expect(storedAsset).toMatchObject({
      fileName: 'large.jpg',
      sizeBytes: 512 * 1024 * 1024,
    });
  });

  test('upload finalization rejects videos beyond the beta duration limit', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['video'], { type: 'video/mp4' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'video',
        fileName: 'long.mp4',
        mimeType: 'video/mp4',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        storageId,
        fileName: 'long.mp4',
        sizeBytes: 1024,
        durationSeconds: 31,
      }),
    ).rejects.toThrow(/30 seconds/i);
  });

  test('cloud upload finalization rejects videos without duration metadata', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['video'], { type: 'video/mp4' }));
    });
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'video',
        fileName: 'missing-duration.mp4',
        mimeType: 'video/mp4',
        status: 'uploading',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(internal.uploads.finalizeComplete, {
        uploadId,
        storageId,
        fileName: 'missing-duration.mp4',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(/duration/i);
  });

  test('self-hosted upload finalization bypasses beta count and duration limits', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      let shareBatchId: Id<'shareBatches'> | null = null;

      for (let index = 0; index < BETA_MAX_MEDIA_SELECTION_COUNT; index++) {
        const uploaded = await createUploadedDraftAsset({
          t,
          user: owner.user,
          viewerId: owner.viewer._id,
          circleId: owner.circleId,
          fileName: `self-hosted-${index}.jpg`,
        });
        shareBatchId = uploaded.shareBatchId;
      }

      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['long-video'], { type: 'video/mp4' }));
      });
      const uploadId = await t.run(async (ctx) => {
        return await ctx.db.insert('uploads', {
          shareBatchId: shareBatchId!,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          providerKind: 'convex-files',
          kind: 'video',
          fileName: 'long-self-hosted.mp4',
          mimeType: 'video/mp4',
          status: 'uploading',
          createdAt: Date.now(),
        });
      });

      await expect(
        owner.user.mutation(internal.uploads.finalizeComplete, {
          uploadId,
          storageId,
          fileName: 'long-self-hosted.mp4',
          sizeBytes: 1024,
          durationSeconds: BETA_MAX_VIDEO_DURATION_SECONDS + 60,
        }),
      ).resolves.toMatchObject({
        assetId: expect.any(String),
      });

      await expect(countShareChildren(t, shareBatchId!)).resolves.toMatchObject({
        assetCount: BETA_MAX_MEDIA_SELECTION_COUNT + 1,
      });
    });
  });

  test('large self-hosted shares return bounded assets with stored total counts', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const now = Date.now();
      const totalAssets = EXPECTED_SHARE_ASSET_DISPLAY_LIMIT + 5;
      const draftShareBatchId = await t.run(async (ctx) => {
        return await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          assetCount: totalAssets,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        });
      });
      const publishedShareBatchId = await t.run(async (ctx) => {
        return await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          assetCount: totalAssets,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        });
      });

      await t.run(async (ctx) => {
        for (const shareBatchId of [draftShareBatchId, publishedShareBatchId]) {
          for (let index = 0; index < totalAssets; index++) {
            const storageId = await ctx.storage.store(
              new Blob([`asset-${shareBatchId}-${index}`], { type: 'image/jpeg' }),
            );

            await ctx.db.insert('assets', {
              shareBatchId,
              circleId: owner.circleId,
              kind: 'image',
              fileName: `asset-${index}.jpg`,
              mimeType: 'image/jpeg',
              storage: {
                provider: 'convex-files',
                storageId,
              },
              createdAt: now + index,
            });
          }
        }
      });

      const draft = await owner.user.query(api.shares.getDraftForCircle, {
        circleId: owner.circleId,
      });
      const published = await owner.user.query(api.shares.getById, {
        shareBatchId: publishedShareBatchId,
      });

      expect(draft?.assetCount).toBe(totalAssets);
      expect(draft?.assets).toHaveLength(EXPECTED_SHARE_ASSET_DISPLAY_LIMIT);
      expect(published?.assetCount).toBe(totalAssets);
      expect(published?.assets).toHaveLength(EXPECTED_SHARE_ASSET_DISPLAY_LIMIT);
    });
  });

  test('draft share asset count is maintained as assets are finalized and deleted', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'counted.jpg',
      });

      await expect(
        t.run(async (ctx) => await ctx.db.get(uploaded.shareBatchId)),
      ).resolves.toMatchObject({
        assetCount: 1,
      });

      await owner.user.action(api.assets.deleteDraftAsset, {
        assetId: uploaded.assetId,
      });

      await expect(
        t.run(async (ctx) => await ctx.db.get(uploaded.shareBatchId)),
      ).resolves.toMatchObject({
        assetCount: 0,
      });
    });
  });

  test('publish requires an uploaded asset and feed listing is paginated with a hero asset', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });

    await expect(
      owner.user.mutation(api.shares.publish, { shareBatchId: draft.shareBatchId }),
    ).rejects.toThrow(/asset/i);

    const first = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'first.jpg',
      sizeBytes: 1000,
    });
    await owner.user.mutation(api.shares.publish, {
      shareBatchId: first.shareBatchId,
      caption: 'First post',
    });

    const second = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'second.jpg',
      sizeBytes: 2000,
    });
    await owner.user.mutation(api.shares.publish, {
      shareBatchId: second.shareBatchId,
      caption: 'Second post',
    });

    const firstPage = await owner.user.query(api.shares.listForCircle, {
      circleId: owner.circleId,
      paginationOpts: { numItems: 1, cursor: null },
    });

    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.page[0]).toMatchObject({
      _id: second.shareBatchId,
      caption: 'Second post',
      assetCount: 1,
      heroAsset: {
        fileName: 'second.jpg',
      },
    });
    expect('assets' in firstPage.page[0]).toBe(false);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await owner.user.query(api.shares.listForCircle, {
      circleId: owner.circleId,
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });

    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.page[0]).toMatchObject({
      _id: first.shareBatchId,
      heroAsset: {
        fileName: 'first.jpg',
      },
    });
    expect(secondPage.isDone).toBe(true);
  });

  test('published shares expose share-level and asset-level comments and reactions to members', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'engaged.jpg',
      caption: 'Engaged post',
    });

    const shareComment = await owner.user.mutation(commentsApi.create, {
      shareBatchId: published.shareBatchId,
      body: 'This belongs to the whole post.',
    });
    const assetComment = await member.user.mutation(commentsApi.create, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      body: 'This is about the photo.',
    });
    await member.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      emoji: '😍',
    });
    await owner.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      emoji: '👍🏽',
    });

    await expect(
      member.user.query(commentsApi.listForShare, {
        shareBatchId: published.shareBatchId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toMatchObject({
      page: [
        {
          _id: shareComment.commentId,
          targetKind: 'share',
          assetId: null,
          body: 'This belongs to the whole post.',
          authorId: owner.viewer._id,
          canDelete: false,
        },
      ],
    });
    await expect(
      owner.user.query(commentsApi.listForShare, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toMatchObject({
      page: [
        {
          _id: assetComment.commentId,
          targetKind: 'asset',
          assetId: published.assetId,
          body: 'This is about the photo.',
          authorId: member.viewer._id,
          canDelete: true,
        },
      ],
    });

    const reactions = await member.user.query(reactionsApi.listForShare, {
      shareBatchId: published.shareBatchId,
    });

    expect(reactions.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: 'share',
          assetId: null,
          reactionCount: 1,
          viewerReaction: '😍',
          topReactions: [
            {
              emoji: '😍',
              count: 1,
              reactedByViewer: true,
            },
          ],
        }),
        expect.objectContaining({
          targetKind: 'asset',
          assetId: published.assetId,
          reactionCount: 1,
          viewerReaction: null,
          topReactions: [
            {
              emoji: '👍🏽',
              count: 1,
              reactedByViewer: false,
            },
          ],
        }),
      ]),
    );

    const feed = await member.user.query(api.shares.listForCircle, {
      circleId: owner.circleId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const detail = await member.user.query(api.shares.getById, {
      shareBatchId: published.shareBatchId,
    });

    expect(feed.page[0]).toMatchObject({
      engagement: {
        commentCount: 2,
        reactionCount: 2,
        topReactions: [
          { emoji: '😍', count: 1, reactedByViewer: true },
          { emoji: '👍🏽', count: 1, reactedByViewer: false },
        ],
      },
    });
    expect(detail).toMatchObject({
      engagement: {
        commentCount: 2,
        reactionCount: 2,
      },
      shareTargetEngagement: {
        commentCount: 1,
        reactionCount: 1,
        topReactions: [
          { emoji: '😍', count: 1, reactedByViewer: true },
        ],
      },
      assets: [
        expect.objectContaining({
          _id: published.assetId,
          engagement: expect.objectContaining({
            commentCount: 1,
            reactionCount: 1,
          }),
        }),
      ],
    });
  });

  test('engagement APIs enforce membership, publication, and asset ownership', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const outsider = await upsertViewer(t, 'outsider@example.com', 'Outsider');
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'published.jpg',
    });
    const otherPublished = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'other.jpg',
    });
    const draft = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'draft.jpg',
    });

    await expect(
      outsider.user.query(commentsApi.listForShare, {
        shareBatchId: published.shareBatchId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/membership/i);
    await expect(
      outsider.user.mutation(commentsApi.create, {
        shareBatchId: published.shareBatchId,
        body: 'No access.',
      }),
    ).rejects.toThrow(/membership/i);
    await expect(
      outsider.user.mutation(reactionsApi.set, {
        shareBatchId: published.shareBatchId,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/membership/i);
    await expect(
      owner.user.mutation(commentsApi.create, {
        shareBatchId: draft.shareBatchId,
        body: 'Draft comment.',
      }),
    ).rejects.toThrow(/published/i);
    await expect(
      owner.user.mutation(reactionsApi.set, {
        shareBatchId: draft.shareBatchId,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/published/i);
    await expect(
      owner.user.mutation(commentsApi.create, {
        shareBatchId: published.shareBatchId,
        assetId: otherPublished.assetId,
        body: 'Wrong asset.',
      }),
    ).rejects.toThrow(/asset/i);
    await expect(
      owner.user.mutation(reactionsApi.set, {
        shareBatchId: published.shareBatchId,
        assetId: otherPublished.assetId,
        emoji: '🔥',
      }),
    ).rejects.toThrow(/asset/i);
  });

  test('reaction replacement and engagement validation keep one emoji reaction per user target', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'reaction.jpg',
    });

    await owner.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      emoji: '👍',
    });
    await owner.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      emoji: '😍',
    });

    const reactions = await owner.user.query(reactionsApi.listForShare, {
      shareBatchId: published.shareBatchId,
    });

    expect(reactions.targets).toEqual([
      {
        targetKind: 'share',
        assetId: null,
        reactionCount: 1,
        viewerReaction: '😍',
        topReactions: [
          {
            emoji: '😍',
            count: 1,
            reactedByViewer: true,
          },
        ],
      },
    ]);
    await expect(
      owner.user.mutation(reactionsApi.set, {
        shareBatchId: published.shareBatchId,
        emoji: 'ok',
      }),
    ).rejects.toThrow(/emoji/i);
    await expect(
      owner.user.mutation(reactionsApi.set, {
        shareBatchId: published.shareBatchId,
        emoji: '👍👍',
      }),
    ).rejects.toThrow(/single emoji/i);
    await expect(
      owner.user.mutation(commentsApi.create, {
        shareBatchId: published.shareBatchId,
        body: '   ',
      }),
    ).rejects.toThrow(/comment/i);
    await expect(
      owner.user.mutation(commentsApi.create, {
        shareBatchId: published.shareBatchId,
        body: 'x'.repeat(COMMENT_MAX_BODY_LENGTH + 1),
      }),
    ).rejects.toThrow(/1000/i);
  });

  test('comment deletion follows author, share author, and admin permissions', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const memberInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const adminInvite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'admin@example.com',
      role: 'admin',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    const admin = await upsertViewer(t, 'admin@example.com', 'Admin');
    await member.user.mutation(api.invites.accept, { token: memberInvite.token });
    await admin.user.mutation(api.invites.accept, { token: adminInvite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'comments.jpg',
    });
    const memberComment = await member.user.mutation(commentsApi.create, {
      shareBatchId: published.shareBatchId,
      body: 'Member comment.',
    });
    const ownerComment = await owner.user.mutation(commentsApi.create, {
      shareBatchId: published.shareBatchId,
      body: 'Owner comment.',
    });

    await expect(
      member.user.mutation(commentsApi.delete, {
        commentId: ownerComment.commentId,
      }),
    ).rejects.toThrow(/delete/i);
    await expect(
      owner.user.mutation(commentsApi.delete, {
        commentId: memberComment.commentId,
      }),
    ).resolves.toEqual({ commentId: memberComment.commentId });
    await expect(
      admin.user.mutation(commentsApi.delete, {
        commentId: ownerComment.commentId,
      }),
    ).resolves.toEqual({ commentId: ownerComment.commentId });

    const remaining = await owner.user.query(commentsApi.listForShare, {
      shareBatchId: published.shareBatchId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(remaining.page).toEqual([]);
  });

  test('share deletion removes comments and reactions with the deleted share', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const invite = await owner.user.mutation(api.invites.create, {
        circleId: owner.circleId,
        invitedEmail: 'member@example.com',
        role: 'member',
      });
      const member = await upsertViewer(t, 'member@example.com', 'Member');
      await member.user.mutation(api.invites.accept, { token: invite.token });
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'cleanup.jpg',
      });

      await owner.user.mutation(commentsApi.create, {
        shareBatchId: published.shareBatchId,
        body: 'Delete me with the share.',
      });
      await owner.user.mutation(commentsApi.create, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        body: 'Delete this asset comment too.',
      });
      await owner.user.mutation(reactionsApi.set, {
        shareBatchId: published.shareBatchId,
        emoji: '🔥',
      });
      await owner.user.mutation(reactionsApi.set, {
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        emoji: '📷',
      });

      await expect(countEngagementRows({ t, shareBatchId: published.shareBatchId })).resolves.toEqual({
        comments: 2,
        reactions: 2,
      });
      await expect(
        listActivityEventsForEntity(t, owner.circleId, published.shareBatchId),
      ).resolves.toHaveLength(5);
      await expect(
        countActivityInboxRows({ t, shareBatchId: published.shareBatchId }),
      ).resolves.toBeGreaterThan(0);

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: published.shareBatchId,
      });

      await expect(countEngagementRows({ t, shareBatchId: published.shareBatchId })).resolves.toEqual({
        comments: 0,
        reactions: 0,
      });
      await expect(
        listActivityEventsForEntity(t, owner.circleId, published.shareBatchId),
      ).resolves.toHaveLength(0);
      await expect(
        countActivityInboxRows({ t, shareBatchId: published.shareBatchId }),
      ).resolves.toBe(0);
    });
  });

  test('activity listing includes publish, comment, and reaction events for members only', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const outsiderCircle = await createCircleFor(t, 'outsider@example.com', 'Outsider Circle');
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'activity.jpg',
    });

    await createPublishedShare({
      t,
      user: outsiderCircle.user,
      viewerId: outsiderCircle.viewer._id,
      circleId: outsiderCircle.circleId,
      fileName: 'outside.jpg',
    });
    await member.user.mutation(commentsApi.create, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      body: 'Activity comment.',
    });
    await owner.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      emoji: '🔥',
    });

    const activity = await member.user.query(activityApi.listForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(activity.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          shareBatchId: published.shareBatchId,
          assetId: null,
        }),
        expect.objectContaining({
          circleId: owner.circleId,
          actorId: member.viewer._id,
          type: 'comment.created',
          shareBatchId: published.shareBatchId,
          assetId: published.assetId,
        }),
        expect.objectContaining({
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'reaction.set',
          shareBatchId: published.shareBatchId,
          assetId: null,
        }),
      ]),
    );
    expect(activity.page.map((event) => event.circleId)).not.toContain(outsiderCircle.circleId);
    expect(activity.page.every((event) => event.displayText.length > 0)).toBe(true);
  });

  test('activity inbox creates unread recipient rows and excludes actor self-events', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'inbox.jpg',
    });

    await member.user.mutation(commentsApi.create, {
      shareBatchId: published.shareBatchId,
      assetId: published.assetId,
      body: 'Inbox comment.',
    });
    await owner.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      emoji: '🔥',
    });

    await expect(owner.user.query(activityApi.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 1,
      hasUnread: true,
    });
    await expect(member.user.query(activityApi.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 2,
      hasUnread: true,
    });

    const memberInbox = await member.user.query(activityApi.listInboxForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(memberInbox.page).toHaveLength(2);
    expect(memberInbox.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: owner.viewer._id,
          type: 'share.published',
          shareBatchId: published.shareBatchId,
          assetId: null,
          status: 'unread',
        }),
        expect.objectContaining({
          actorId: owner.viewer._id,
          type: 'reaction.set',
          shareBatchId: published.shareBatchId,
          assetId: null,
          status: 'unread',
        }),
      ]),
    );
    expect(memberInbox.page.map((event) => event.type)).not.toContain('comment.created');

    const ownerInbox = await owner.user.query(activityApi.listInboxForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(ownerInbox.page).toEqual([
      expect.objectContaining({
        actorId: member.viewer._id,
        type: 'comment.created',
        shareBatchId: published.shareBatchId,
        assetId: published.assetId,
        status: 'unread',
      }),
    ]);
  });

  test('activity inbox read mutations are idempotent and scoped to the viewer', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      invitedEmail: 'member@example.com',
      role: 'member',
    });
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    const outsider = await createCircleFor(t, 'outsider@example.com');
    await member.user.mutation(api.invites.accept, { token: invite.token });
    const published = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'read-state.jpg',
    });
    await owner.user.mutation(reactionsApi.set, {
      shareBatchId: published.shareBatchId,
      emoji: '❤️',
    });
    const memberInbox = await member.user.query(activityApi.listInboxForViewer, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(memberInbox.page).toHaveLength(2);

    const [firstItem, ...allItems] = memberInbox.page;

    await expect(
      outsider.user.mutation(activityApi.markRead, {
        inboxItemId: firstItem!._id,
      }),
    ).rejects.toThrow(/activity/i);
    await expect(
      member.user.mutation(activityApi.markRead, {
        inboxItemId: firstItem!._id,
      }),
    ).resolves.toEqual({
      inboxItemId: firstItem!._id,
      status: 'read',
    });
    await expect(
      member.user.mutation(activityApi.markRead, {
        inboxItemId: firstItem!._id,
      }),
    ).resolves.toEqual({
      inboxItemId: firstItem!._id,
      status: 'read',
    });
    await expect(member.user.query(activityApi.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 1,
      hasUnread: true,
    });
    await expect(
      member.user.mutation(activityApi.markManyRead, {
        inboxItemIds: [firstItem!, ...allItems].map((item) => item._id),
      }),
    ).resolves.toEqual({
      readCount: 2,
    });
    await expect(member.user.query(activityApi.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 0,
      hasUnread: false,
    });
  });

  test('activity inbox unread summary caps at ninety-nine', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');

    await t.run(async (ctx) => {
      const db = ctx.db as unknown as {
        insert: (tableName: string, value: Record<string, unknown>) => Promise<string>;
      };
      const shareBatchId = await db.insert('shareBatches', {
        circleId: owner.circleId,
        authorId: owner.viewer._id,
        assetCount: 1,
        status: 'published',
        createdAt: 0,
        updatedAt: 0,
        publishedAt: 0,
      });

      for (let index = 0; index < 105; index++) {
        const activityEventId = await db.insert('activityEvents', {
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          entityId: shareBatchId,
          shareBatchId,
          createdAt: index,
        });

        await db.insert('activityInboxItems', {
          activityEventId,
          userId: owner.viewer._id,
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          shareBatchId,
          status: 'unread',
          createdAt: index,
        });
      }
    });

    await expect(owner.user.query(activityApi.summaryForViewer, {})).resolves.toEqual({
      unreadCount: 99,
      hasUnread: true,
    });
  });

  test('activity listing paginates across viewer circles', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'activity-owner@example.com');
    const secondCircle = await owner.user.mutation(api.circles.create, {
      name: 'Second',
      description: 'Second private circle',
    });
    const first = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'first-activity.jpg',
    });
    const second = await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: secondCircle.circleId as Id<'circles'>,
      fileName: 'second-activity.jpg',
    });

    const firstPage = await owner.user.query(activityApi.listForViewer, {
      paginationOpts: { numItems: 1, cursor: null },
    });

    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await owner.user.query(activityApi.listForViewer, {
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });

    expect([...firstPage.page, ...secondPage.page].map((event) => event.shareBatchId)).toEqual(
      expect.arrayContaining([first.shareBatchId, second.shareBatchId]),
    );
  });

  test('publish rejects drafts with unresolved upload rows', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('uploads', {
        shareBatchId: uploaded.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'failed.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'Upload failed before completion.',
        createdAt: Date.now(),
      });
    });

    await expect(
      owner.user.mutation(api.shares.publish, {
        shareBatchId: uploaded.shareBatchId,
      }),
    ).rejects.toThrow(/upload/i);
  });

  test('draft exposes persisted unresolved uploads so they can be discarded after restart', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const uploaded = await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'ready.jpg',
      sizeBytes: 1024,
    });
    const failedUploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: uploaded.shareBatchId,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'interrupted.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'Network dropped.',
        createdAt: Date.now(),
      });
    });

    const draftBefore = await owner.user.query(api.shares.getDraftForCircle, {
      circleId: owner.circleId,
    });

    expect(draftBefore?.unresolvedUploads).toEqual([
      expect.objectContaining({
        _id: failedUploadId,
        fileName: 'interrupted.jpg',
        status: 'failed',
        failureReason: 'Network dropped.',
      }),
    ]);

    await owner.user.action(api.uploads.discard, { uploadId: failedUploadId });

    const draftAfter = await owner.user.query(api.shares.getDraftForCircle, {
      circleId: owner.circleId,
    });

    expect(draftAfter?.unresolvedUploads).toEqual([]);
    await expect(
      owner.user.mutation(api.shares.publish, { shareBatchId: uploaded.shareBatchId }),
    ).resolves.toMatchObject({ shareBatchId: uploaded.shareBatchId, assetCount: 1 });
  });

  test('storage counters track upload completion, draft asset deletion, and share deletion', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        sizeBytes: 4096,
      });

      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 1,
        videoCount: 0,
        totalSizeBytes: 4096,
      });
      await expect(owner.user.query(api.storageStats.forViewer, {})).resolves.toEqual({
        imageCount: 1,
        videoCount: 0,
        totalSizeBytes: 4096,
        circleCount: 1,
        isTruncated: false,
      });

      await owner.user.action(api.assets.deleteDraftAsset, {
        assetId: uploaded.assetId,
      });
      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      });

      const republished = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        kind: 'video',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 8192,
      });
      await owner.user.mutation(api.shares.publish, {
        shareBatchId: republished.shareBatchId,
      });
      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 1,
        totalSizeBytes: 8192,
      });

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: republished.shareBatchId,
      });
      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      });
    });
  });

  test('draft asset deletion uses the asset upload index without touching unrelated uploads', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
        circleId: owner.circleId,
      });
      const now = Date.now();
      const targetStorageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['target'], { type: 'image/jpeg' }));
      });
      const targetAssetId = await t.run(async (ctx) => {
        return await ctx.db.insert('assets', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          kind: 'image',
          fileName: 'target.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          storage: {
            provider: 'convex-files',
            storageId: targetStorageId,
          },
          createdAt: now,
        });
      });
      const targetUploadId = await t.run(async (ctx) => {
        return await ctx.db.insert('uploads', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          assetId: targetAssetId,
          providerKind: 'convex-files',
          kind: 'image',
          fileName: 'target.jpg',
          mimeType: 'image/jpeg',
          storage: {
            provider: 'convex-files',
            storageId: targetStorageId,
          },
          status: 'uploaded',
          createdAt: now,
          completedAt: now,
        });
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < 75; index++) {
          const storageId = await ctx.storage.store(
            new Blob([`unrelated-${index}`], { type: 'image/jpeg' }),
          );
          const assetId = await ctx.db.insert('assets', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `unrelated-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: now + index + 1,
          });

          await ctx.db.insert('uploads', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            createdBy: owner.viewer._id,
            assetId,
            providerKind: 'convex-files',
            kind: 'image',
            fileName: `unrelated-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            status: 'uploaded',
            createdAt: now + index + 1,
            completedAt: now + index + 1,
          });
        }
      });

      await expect(
        t.run(async (ctx) => {
          return await ctx.db
            .query('uploads')
            .withIndex('by_asset', (q) => q.eq('assetId', targetAssetId))
            .collect();
        }),
      ).resolves.toHaveLength(1);
      await expect(countUploadsForShareBatch(t, draft.shareBatchId as Id<'shareBatches'>))
        .resolves.toBe(76);

      await owner.user.action(api.assets.deleteDraftAsset, {
        assetId: targetAssetId,
      });

      await expect(t.run(async (ctx) => await ctx.db.get(targetAssetId))).resolves.toBeNull();
      await expect(t.run(async (ctx) => await ctx.db.get(targetUploadId))).resolves.toBeNull();
      await expect(countUploadsForShareBatch(t, draft.shareBatchId as Id<'shareBatches'>))
        .resolves.toBe(75);
    });
  });

  test('draft asset deletion rejects anomalous assets with too many linked uploads', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
        circleId: owner.circleId,
      });
      const now = Date.now();
      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(['target'], { type: 'image/jpeg' }));
      });
      const assetId = await t.run(async (ctx) => {
        return await ctx.db.insert('assets', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          kind: 'image',
          fileName: 'overlinked.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          storage: {
            provider: 'convex-files',
            storageId,
          },
          createdAt: now,
        });
      });
      const uploadIds = await t.run(async (ctx) => {
        const insertedUploadIds: Array<Id<'uploads'>> = [];

        for (let index = 0; index < EXPECTED_ASSET_LINKED_UPLOAD_DELETE_LIMIT + 1; index++) {
          insertedUploadIds.push(
            await ctx.db.insert('uploads', {
              shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
              circleId: owner.circleId,
              createdBy: owner.viewer._id,
              assetId,
              providerKind: 'convex-files',
              kind: 'image',
              fileName: `overlinked-${index}.jpg`,
              mimeType: 'image/jpeg',
              storage: {
                provider: 'convex-files',
                storageId,
              },
              status: 'uploaded',
              createdAt: now + index,
              completedAt: now + index,
            }),
          );
        }

        return insertedUploadIds;
      });

      await expect(
        owner.user.action(api.assets.deleteDraftAsset, {
          assetId,
        }),
      ).rejects.toThrow(/too many linked uploads/i);
      await expect(t.run(async (ctx) => await ctx.db.get(assetId))).resolves.not.toBeNull();

      for (const uploadId of uploadIds) {
        await expect(t.run(async (ctx) => await ctx.db.get(uploadId))).resolves.not.toBeNull();
      }
    });
  });

  test('share deletion removes all legacy over-capacity assets and uploads', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const now = Date.now();
      const shareBatchId = await t.run(async (ctx) => {
        return await ctx.db.insert('shareBatches', {
          circleId: owner.circleId,
          authorId: owner.viewer._id,
          assetCount: BETA_MAX_MEDIA_SELECTION_COUNT + 2,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        });
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < BETA_MAX_MEDIA_SELECTION_COUNT + 2; index++) {
          const storageId = await ctx.storage.store(
            new Blob([`legacy-${index}`], { type: 'image/jpeg' }),
          );
          const assetId = await ctx.db.insert('assets', {
            shareBatchId,
            circleId: owner.circleId,
            kind: 'image',
            fileName: `legacy-${index}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            storage: {
              provider: 'convex-files',
              storageId,
            },
            createdAt: now + index,
          });

          await ctx.db.insert('uploads', {
            shareBatchId,
            circleId: owner.circleId,
            createdBy: owner.viewer._id,
            assetId,
            providerKind: 'convex-files',
            kind: 'image',
            fileName: `legacy-${index}.jpg`,
            mimeType: 'image/jpeg',
            storage: {
              provider: 'convex-files',
              storageId,
            },
            status: 'uploaded',
            createdAt: now + index,
            completedAt: now + index,
          });
        }

        await ctx.db.insert('activityEvents', {
          circleId: owner.circleId,
          actorId: owner.viewer._id,
          type: 'share.published',
          entityId: shareBatchId,
          createdAt: now,
        });

        const stats = await ctx.db
          .query('circleStats')
          .withIndex('by_circle', (q) => q.eq('circleId', owner.circleId))
          .unique();

        if (!stats) {
          throw new Error('Expected circle stats row to exist.');
        }

        await ctx.db.patch(stats._id, {
          imageCount: BETA_MAX_MEDIA_SELECTION_COUNT + 2,
          videoCount: 0,
          totalSizeBytes: (BETA_MAX_MEDIA_SELECTION_COUNT + 2) * 100,
          updatedAt: now,
        });
      });

      await expect(countShareChildren(t, shareBatchId)).resolves.toEqual({
        assetCount: BETA_MAX_MEDIA_SELECTION_COUNT + 2,
        uploadCount: BETA_MAX_MEDIA_SELECTION_COUNT + 2,
      });

      await owner.user.action(api.shares.deleteShare, { shareBatchId });

      await expect(countShareChildren(t, shareBatchId)).resolves.toEqual({
        assetCount: 0,
        uploadCount: 0,
      });
      await expect(t.run(async (ctx) => await ctx.db.get(shareBatchId))).resolves.toBeNull();
      await expect(
        listActivityEventsForEntity(t, owner.circleId, shareBatchId),
      ).resolves.toHaveLength(0);

      await expect(getCircleStats(t, owner.circleId)).resolves.toMatchObject({
        imageCount: 0,
        videoCount: 0,
        totalSizeBytes: 0,
      });
    });
  });

  test('share deletion removes its activity event after more than 100 circle events', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');

      await t.run(async (ctx) => {
        for (let index = 0; index < 105; index++) {
          await ctx.db.insert('activityEvents', {
            circleId: owner.circleId,
            actorId: owner.viewer._id,
            type: 'share.published',
            entityId: `legacy-share-${index}`,
            createdAt: index,
          });
        }
      });

      const uploaded = await createUploadedDraftAsset({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'cleanup-target.jpg',
      });

      await owner.user.mutation(api.shares.publish, {
        shareBatchId: uploaded.shareBatchId,
      });
      await expect(
        listActivityEventsForEntity(t, owner.circleId, uploaded.shareBatchId),
      ).resolves.toHaveLength(1);

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: uploaded.shareBatchId,
      });

      await expect(
        listActivityEventsForEntity(t, owner.circleId, uploaded.shareBatchId),
      ).resolves.toHaveLength(0);
    });
  });

  test('share deletion batches same-share activity events before finalizing', async () => {
    await withDeploymentKind('self-hosted', async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const published = await createPublishedShare({
        t,
        user: owner.user,
        viewerId: owner.viewer._id,
        circleId: owner.circleId,
        fileName: 'activity-batch.jpg',
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < EXPECTED_SHARE_DELETE_BATCH_SIZE + 3; index++) {
          await ctx.db.insert('activityEvents', {
            circleId: owner.circleId,
            actorId: owner.viewer._id,
            type: 'comment.created',
            entityId: published.shareBatchId,
            shareBatchId: published.shareBatchId,
            createdAt: Date.now() + index,
          });
        }
      });

      const firstDeleteContext = await owner.user.query(internal.shares.getDeleteContext, {
        shareBatchId: published.shareBatchId,
      }) as {
        activityEventIds?: Id<'activityEvents'>[];
        isFinalBatch: boolean;
      };

      expect(firstDeleteContext.activityEventIds).toHaveLength(EXPECTED_SHARE_DELETE_BATCH_SIZE);
      expect(firstDeleteContext.isFinalBatch).toBe(false);

      await owner.user.action(api.shares.deleteShare, {
        shareBatchId: published.shareBatchId,
      });

      await expect(
        listActivityEventsForEntity(t, owner.circleId, published.shareBatchId),
      ).resolves.toHaveLength(0);
      await expect(t.run(async (ctx) => await ctx.db.get(published.shareBatchId))).resolves.toBeNull();
    });
  });

  test('stale media cleanup deletes old pending upload rows and storage references', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const now = Date.now();
    const staleCreatedAt = now - 25 * 60 * 60 * 1000;
    const uploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'stale/original.jpg',
        },
        previewPendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'stale/preview.jpg',
        },
        kind: 'image',
        fileName: 'original.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: staleCreatedAt,
      });
    });
    const imageUploadId = await t.run(async (ctx) => {
      return await ctx.db.insert('imageUploads', {
        targetKind: 'user-profile',
        userId: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'stale/profile.jpg',
        },
        fileName: 'profile.jpg',
        mimeType: 'image/jpeg',
        status: 'failed',
        failureReason: 'interrupted',
        createdAt: staleCreatedAt,
      });
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    try {
      await withS3SigningEnv(async () => {
        await expect(
          owner.user.action(internal.mediaCleanup.cleanupStale, {
            now,
          }),
        ).resolves.toEqual({
          scanned: 2,
          deleted: 2,
          failed: 0,
          hasMore: false,
        });
      });

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      await expect(t.run(async (ctx) => await ctx.db.get(uploadId))).resolves.toBeNull();
      await expect(t.run(async (ctx) => await ctx.db.get(imageUploadId))).resolves.toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('stale media cleanup is bounded and ignores recent or completed upload rows', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const now = Date.now();
    const staleCreatedAt = now - 25 * 60 * 60 * 1000;
    const recentCreatedAt = now - 60 * 60 * 1000;
    const completedStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['completed'], { type: 'image/jpeg' }));
    });
    const completedAssetId = await t.run(async (ctx) => {
      return await ctx.db.insert('assets', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        kind: 'image',
        fileName: 'completed.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId: completedStorageId,
        },
        createdAt: staleCreatedAt,
      });
    });
    const preservedIds = await t.run(async (ctx) => {
      const ids: Array<Id<'uploads'>> = [];

      for (let index = 0; index < 51; index++) {
        ids.push(
          await ctx.db.insert('uploads', {
            shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
            circleId: owner.circleId,
            createdBy: owner.viewer._id,
            providerKind: 's3',
            pendingStorage: {
              provider: 's3',
              bucket: 'media-bucket',
              objectKey: `stale/batch-${index}.jpg`,
            },
            kind: 'image',
            fileName: `batch-${index}.jpg`,
            mimeType: 'image/jpeg',
            status: 'failed',
            failureReason: 'interrupted',
            createdAt: staleCreatedAt + index,
          }),
        );
      }

      const recentId = await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        providerKind: 's3',
        pendingStorage: {
          provider: 's3',
          bucket: 'media-bucket',
          objectKey: 'recent/upload.jpg',
        },
        kind: 'image',
        fileName: 'recent.jpg',
        mimeType: 'image/jpeg',
        status: 'uploading',
        createdAt: recentCreatedAt,
      });
      const completedUploadId = await ctx.db.insert('uploads', {
        shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
        circleId: owner.circleId,
        createdBy: owner.viewer._id,
        assetId: completedAssetId,
        providerKind: 'convex-files',
        kind: 'image',
        fileName: 'completed.jpg',
        mimeType: 'image/jpeg',
        storage: {
          provider: 'convex-files',
          storageId: completedStorageId,
        },
        status: 'uploaded',
        createdAt: staleCreatedAt,
        completedAt: staleCreatedAt,
      });

      return {
        firstStaleId: ids[0]!,
        lastStaleId: ids[50]!,
        recentId,
        completedUploadId,
      };
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    try {
      await withS3SigningEnv(async () => {
        await expect(
          owner.user.action(internal.mediaCleanup.cleanupStale, {
            now,
          }),
        ).resolves.toEqual({
          scanned: 50,
          deleted: 50,
          failed: 0,
          hasMore: true,
        });
      });

      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.firstStaleId)))
        .resolves.toBeNull();
      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.lastStaleId)))
        .resolves.toMatchObject({
          status: 'failed',
        });
      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.recentId)))
        .resolves.toMatchObject({
          status: 'uploading',
        });
      await expect(t.run(async (ctx) => await ctx.db.get(preservedIds.completedUploadId)))
        .resolves.toMatchObject({
          status: 'uploaded',
          assetId: completedAssetId,
        });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('stale media cleanup schedules follow-up batches when requested', async () => {
    vi.useFakeTimers();
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com');
    const draft = await owner.user.mutation(api.shares.getOrCreateDraft, {
      circleId: owner.circleId,
    });
    const now = Date.now();
    const staleCreatedAt = now - 25 * 60 * 60 * 1000;

    await t.run(async (ctx) => {
      for (let index = 0; index < 51; index++) {
        await ctx.db.insert('uploads', {
          shareBatchId: draft.shareBatchId as Id<'shareBatches'>,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          providerKind: 's3',
          pendingStorage: {
            provider: 's3',
            bucket: 'media-bucket',
            objectKey: `stale/scheduled-${index}.jpg`,
          },
          kind: 'image',
          fileName: `scheduled-${index}.jpg`,
          mimeType: 'image/jpeg',
          status: 'failed',
          failureReason: 'interrupted',
          createdAt: staleCreatedAt + index,
        });
      }
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    try {
      await withS3SigningEnv(async () => {
        await expect(
          owner.user.action(internal.mediaCleanup.cleanupStale, {
            now,
            continueOnMore: true,
          }),
        ).resolves.toEqual({
          scanned: 50,
          deleted: 50,
          failed: 0,
          hasMore: true,
        });

        await owner.user.finishAllScheduledFunctions(() => vi.runAllTimers());
      });

      const remaining = await countUploadsForShareBatch(
        t,
        draft.shareBatchId as Id<'shareBatches'>,
      );

      expect(remaining).toBe(0);
      expect(fetchSpy).toHaveBeenCalledTimes(51);
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
