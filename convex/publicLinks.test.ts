/// <reference types="vite/client" />

import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference, type UserIdentity } from 'convex/server';
import { describe, expect, test, vi } from 'vitest';

const rcMocks = vi.hoisted(() => ({
  hasEntitlement: vi.fn(),
  getActiveSubscriptions: vi.fn(),
  getCustomer: vi.fn(),
}));

vi.mock('convex-revenuecat', async () => {
  const { httpActionGeneric } = await import('convex/server');

  return {
    RevenueCat: vi.fn(function RevenueCatMock() {
      return {
        hasEntitlement: rcMocks.hasEntitlement,
        getActiveSubscriptions: rcMocks.getActiveSubscriptions,
        getCustomer: rcMocks.getCustomer,
        httpHandler: () =>
          httpActionGeneric(async () => new Response(null, { status: 501 })),
      };
    }),
  };
});

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

const publicLinksApi = {
  createForCircle: makeFunctionReference<
    'mutation',
    { circleId: Id<'circles'> },
    {
      publicLinkId: string;
      token: string;
      shareUrl: string;
      expiresAt: number;
    }
  >('publicLinks:createForCircle'),
  revoke: makeFunctionReference<
    'mutation',
    { publicLinkId: string },
    { publicLinkId: string; status: 'revoked' }
  >('publicLinks:revoke'),
};

const publicLinksInternal = {
  resolvePublicCirclePayload: makeFunctionReference<
    'action',
    { token: string; cursor?: string | null },
    {
      circle: {
        name: string;
      };
      shares: Array<{
        caption: string;
        assets: Array<{
          kind: 'image' | 'video';
          url: string | null;
        }>;
      }>;
      isDone: boolean;
      continueCursor: string;
    } | null
  >('publicLinks:resolvePublicCirclePayload'),
};

function createTestDb() {
  return convexTest(schema, modules);
}

const CLERK_TEST_ISSUER = 'https://test.clerk.accounts.dev';

function clerkIdentity(email: string, name = email): Partial<UserIdentity> {
  const subject = `user_${email.replace(/[^a-z0-9]+/gi, '_')}`;

  return {
    issuer: CLERK_TEST_ISSUER,
    subject,
    tokenIdentifier: `${CLERK_TEST_ISSUER}|${subject}`,
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
  const user = t.withIdentity(clerkIdentity(email, displayName));
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

async function createUploadedDraftAsset(input: {
  t: TestDb;
  user: TestUser;
  viewerId: Id<'users'>;
  circleId: Id<'circles'>;
  fileName?: string;
  mimeType?: string;
}) {
  const fileName = input.fileName ?? 'photo.jpg';
  const mimeType = input.mimeType ?? 'image/jpeg';
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
      kind: 'image',
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
    sizeBytes: 2048,
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
  caption: string;
}) {
  const uploaded = await createUploadedDraftAsset(input);

  await input.user.mutation(api.shares.publish, {
    shareBatchId: uploaded.shareBatchId,
    caption: input.caption,
  });

  return uploaded;
}

async function readPublicLinkRows(t: TestDb, circleId: Id<'circles'>) {
  return await t.run(async (ctx) => {
    return await (ctx.db as any)
      .query('publicCircleLinks')
      .withIndex('by_circle', (q: any) => q.eq('circleId', circleId))
      .collect();
  });
}

describe('public circle links', () => {
  test('managers can create a revocable hashed public link for published circle media', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com', 'Sommer mit Oma');

    await createPublishedShare({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      caption: 'Erster Ausflug',
    });
    await createUploadedDraftAsset({
      t,
      user: owner.user,
      viewerId: owner.viewer._id,
      circleId: owner.circleId,
      fileName: 'draft-only.jpg',
    });

    const created = await owner.user.mutation(publicLinksApi.createForCircle, {
      circleId: owner.circleId,
    });

    expect(created.token).toHaveLength(64);
    expect(created.shareUrl).toContain('/share/#');
    expect(created.shareUrl).toContain(encodeURIComponent(created.token));

    const rows = await readPublicLinkRows(t, owner.circleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(created.token);
    expect(rows[0].status).toBe('active');

    const payload = await t.action(publicLinksInternal.resolvePublicCirclePayload, {
      token: created.token,
      cursor: null,
    });

    expect(payload).toMatchObject({
      circle: {
        name: 'Sommer mit Oma',
      },
      shares: [
        {
          caption: 'Erster Ausflug',
          assets: [
            {
              kind: 'image',
            },
          ],
        },
      ],
    });
    expect(payload?.shares).toHaveLength(1);
    expect(payload?.shares[0]?.assets[0]?.url).toEqual(expect.any(String));

    await owner.user.mutation(publicLinksApi.revoke, {
      publicLinkId: created.publicLinkId,
    });

    await expect(
      t.action(publicLinksInternal.resolvePublicCirclePayload, {
        token: created.token,
        cursor: null,
      }),
    ).resolves.toBeNull();
  });

  test('regular members cannot create public circle links', async () => {
    const t = createTestDb();
    const owner = await createCircleFor(t, 'owner@example.com', 'Private Family');
    const member = await upsertViewer(t, 'member@example.com', 'Member');
    const invite = await owner.user.mutation(api.invites.create, {
      circleId: owner.circleId,
      mode: 'open',
      role: 'member',
    });

    await member.user.mutation(api.invites.accept, { token: invite.token });

    await expect(
      member.user.mutation(publicLinksApi.createForCircle, {
        circleId: owner.circleId,
      }),
    ).rejects.toThrow('Only owners and admins can manage public links.');
  });
});
