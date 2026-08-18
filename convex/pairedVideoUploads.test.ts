/// <reference types="vite/client" />

import { convexTest, type TestConvex } from 'convex-test';
import type { UserIdentity } from 'convex/server';
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

vi.mock('@convex-dev/resend', () => ({
  Resend: vi.fn(function ResendMock() {
    return {
      sendEmail: vi.fn(),
    };
  }),
}));

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { MAX_UPLOAD_SIZE_BYTES } from './lib/uploadLimits';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

const DECLARED_SIZE_BYTES = 4096;
const DECLARED_PREVIEW_SIZE_BYTES = 512;
const DECLARED_PAIRED_VIDEO_SIZE_BYTES = 2048;

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

async function createCircleFor(
  t: TestDb,
  email: string,
): Promise<{ user: TestUser; viewer: Doc<'users'>; circleId: Id<'circles'> }> {
  const user = t.withIdentity(clerkIdentity(email));
  const result = await user.mutation(api.users.upsertFromIdentity, {
    email,
    displayName: email,
  });

  if (typeof result !== 'object' || result === null || !('_id' in result)) {
    throw new Error('Expected upsertFromIdentity to return a viewer record.');
  }

  const viewer = result as Doc<'users'>;
  const created = await user.mutation(api.circles.create, {
    name: 'Family',
    description: 'Private circle',
  });

  return { user, viewer, circleId: created.circleId as Id<'circles'> };
}

function mockEntitledTier(tier: 'cloud_plus' | 'cloud_max' | null): void {
  rcMocks.hasEntitlement.mockReset();
  rcMocks.hasEntitlement.mockImplementation(
    async (_ctx: unknown, args: { entitlementId: string }) =>
      tier !== null && args.entitlementId === tier,
  );
}

async function withUploadEnv<T>(
  options: { billingConfigured?: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const savedEnv: Record<string, string | undefined> = {
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
  };

  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.S3_BUCKET = 'media-bucket';

  if (options.billingConfigured) {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'rc_webhook_test_secret';
  } else {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
  }

  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

async function createDraftFor(
  user: TestUser,
  circleId: Id<'circles'>,
): Promise<Id<'shareBatches'>> {
  const draft = await user.mutation(api.shares.getOrCreateDraft, { circleId });
  return draft.shareBatchId as Id<'shareBatches'>;
}

function livePhotoTargetArgs(
  circleId: Id<'circles'>,
  shareBatchId: Id<'shareBatches'>,
  overrides: Partial<{
    kind: 'image' | 'video';
    mimeType: string;
    fileName: string;
    pairedVideoSizeBytes: number;
    pairedVideoMimeType: string;
  }> = {},
) {
  return {
    circleId,
    shareBatchId,
    kind: 'image' as const,
    mimeType: 'image/heic',
    fileName: 'photo.heic',
    sizeBytes: DECLARED_SIZE_BYTES,
    previewSizeBytes: DECLARED_PREVIEW_SIZE_BYTES,
    pairedVideoSizeBytes: DECLARED_PAIRED_VIDEO_SIZE_BYTES,
    pairedVideoMimeType: 'video/quicktime',
    ...overrides,
  };
}

async function readOwnerStorageUsage(
  t: TestDb,
  ownerId: Id<'users'>,
): Promise<number> {
  return await t.run(async (ctx) => {
    const row = await ctx.db
      .query('billingStorage')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .unique();

    return row?.totalBytes ?? 0;
  });
}

function mockS3Fetch(handlers: {
  headSizeFor: (url: string) => number;
  onDelete?: (url: string) => void;
}): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === 'DELETE') {
        handlers.onDelete?.(url);
        return new Response(null, { status: 204 });
      }

      return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(handlers.headSizeFor(url)),
        },
      });
    });
}

function headSizeByVariant(url: string): number {
  if (url.includes('/paired/')) {
    return DECLARED_PAIRED_VIDEO_SIZE_BYTES;
  }

  if (url.includes('/previews/')) {
    return DECLARED_PREVIEW_SIZE_BYTES;
  }

  return DECLARED_SIZE_BYTES;
}

describe('paired video target creation', () => {
  test('createTarget validates paired video declarations', async () => {
    await withUploadEnv({ billingConfigured: false }, async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);
      const baseArgs = livePhotoTargetArgs(owner.circleId, shareBatchId);

      await expect(
        owner.user.action(api.uploads.createTarget, {
          ...baseArgs,
          kind: 'video',
          mimeType: 'video/mp4',
          fileName: 'clip.mp4',
        }),
      ).rejects.toThrow(/can only accompany an image upload/);

      const { pairedVideoMimeType: _mime, ...withoutMime } = baseArgs;
      await expect(
        owner.user.action(api.uploads.createTarget, withoutMime),
      ).rejects.toThrow(/pairedVideoMimeType is required/);

      const { pairedVideoSizeBytes: _size, ...withoutSize } = baseArgs;
      await expect(
        owner.user.action(api.uploads.createTarget, withoutSize),
      ).rejects.toThrow(/pairedVideoSizeBytes is required/);

      await expect(
        owner.user.action(api.uploads.createTarget, {
          ...baseArgs,
          pairedVideoMimeType: 'image/jpeg',
        }),
      ).rejects.toThrow(/not supported/);

      await expect(
        owner.user.action(api.uploads.createTarget, {
          ...baseArgs,
          pairedVideoSizeBytes: MAX_UPLOAD_SIZE_BYTES + 1,
        }),
      ).rejects.toThrow(/exceeds the maximum/);
    });
  });

  test('createTarget and retry sign a third PUT for the paired video', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        livePhotoTargetArgs(owner.circleId, shareBatchId),
      );

      expect(prepared.pairedVideoTarget).toBeDefined();
      expect(prepared.pairedVideoTarget?.headers?.['content-length']).toBe(
        String(DECLARED_PAIRED_VIDEO_SIZE_BYTES),
      );
      expect(prepared.pairedVideoTarget?.objectKey).toContain('/paired/');
      expect(prepared.pairedVideoTarget?.objectKey).toMatch(/-paired\.mov$/);

      const retried = await owner.user.action(api.uploads.retry, {
        uploadId: prepared.uploadId,
      });

      expect(retried.pairedVideoTarget?.objectKey).toBe(
        prepared.pairedVideoTarget?.objectKey,
      );
      expect(retried.pairedVideoTarget?.headers?.['content-length']).toBe(
        String(DECLARED_PAIRED_VIDEO_SIZE_BYTES),
      );
    });
  });

  test('a plain upload target carries no paired video target', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);
      const {
        pairedVideoSizeBytes: _size,
        pairedVideoMimeType: _mime,
        ...plainArgs
      } = livePhotoTargetArgs(owner.circleId, shareBatchId);

      const prepared = await owner.user.action(api.uploads.createTarget, plainArgs);

      expect(prepared.pairedVideoTarget).toBeUndefined();
    });
  });
});

describe('paired video completion', () => {
  test('complete requires the declared paired video, verifies it, and charges both files', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        livePhotoTargetArgs(owner.circleId, shareBatchId),
      );

      const fetchSpy = mockS3Fetch({ headSizeFor: headSizeByVariant });

      try {
        await expect(
          owner.user.action(api.uploads.complete, {
            uploadId: prepared.uploadId,
            objectKey: prepared.target.objectKey,
            ...(prepared.previewTarget
              ? { previewObjectKey: prepared.previewTarget.objectKey }
              : {}),
          }),
        ).rejects.toThrow(/missing its paired video object key/);

        const completed = await owner.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          objectKey: prepared.target.objectKey,
          ...(prepared.previewTarget
            ? { previewObjectKey: prepared.previewTarget.objectKey }
            : {}),
          ...(prepared.pairedVideoTarget
            ? { pairedVideoObjectKey: prepared.pairedVideoTarget.objectKey }
            : {}),
          pairedVideoDurationSeconds: 2.5,
        });

        const asset = await t.run(
          async (ctx) => await ctx.db.get(completed.assetId as Id<'assets'>),
        );

        expect(asset?.pairedVideoStorage?.provider).toBe('s3');
        expect(
          asset?.pairedVideoStorage?.provider === 's3'
            ? asset.pairedVideoStorage.objectKey
            : undefined,
        ).toBe(prepared.pairedVideoTarget?.objectKey);
        expect(asset?.pairedVideoSizeBytes).toBe(DECLARED_PAIRED_VIDEO_SIZE_BYTES);
        expect(asset?.pairedVideoMimeType).toBe('video/quicktime');
        expect(asset?.pairedVideoDurationSeconds).toBe(2.5);
      } finally {
        fetchSpy.mockRestore();
      }

      // The Live Photo counts as one media upload but stores both files.
      expect(await readOwnerStorageUsage(t, owner.viewer._id)).toBe(
        DECLARED_SIZE_BYTES + DECLARED_PAIRED_VIDEO_SIZE_BYTES,
      );

      const stats = await t.run(async (ctx) =>
        ctx.db
          .query('circleStats')
          .withIndex('by_circle', (q) => q.eq('circleId', owner.circleId))
          .unique(),
      );

      expect(stats?.imageCount).toBe(1);
      expect(stats?.videoCount).toBe(0);
      expect(stats?.totalSizeBytes).toBe(
        DECLARED_SIZE_BYTES + DECLARED_PAIRED_VIDEO_SIZE_BYTES,
      );
    });
  });

  test('a paired video size mismatch fails the upload and deletes all objects', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        livePhotoTargetArgs(owner.circleId, shareBatchId),
      );

      const deletedUrls: string[] = [];
      const fetchSpy = mockS3Fetch({
        headSizeFor: (url) =>
          url.includes('/paired/') ? 999_999 : headSizeByVariant(url),
        onDelete: (url) => deletedUrls.push(url),
      });

      try {
        await expect(
          owner.user.action(api.uploads.complete, {
            uploadId: prepared.uploadId,
            objectKey: prepared.target.objectKey,
            ...(prepared.previewTarget
              ? { previewObjectKey: prepared.previewTarget.objectKey }
              : {}),
            ...(prepared.pairedVideoTarget
              ? { pairedVideoObjectKey: prepared.pairedVideoTarget.objectKey }
              : {}),
          }),
        ).rejects.toThrow(/paired video size does not match/);
      } finally {
        fetchSpy.mockRestore();
      }

      expect(deletedUrls.some((url) => url.includes('/paired/'))).toBe(true);

      const upload = await t.run(async (ctx) => await ctx.db.get(prepared.uploadId));
      expect(upload?.status).toBe('failed');
      expect(await readOwnerStorageUsage(t, owner.viewer._id)).toBe(0);
    });
  });

  test('deleting the draft asset frees the paired bytes and the paired object', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        livePhotoTargetArgs(owner.circleId, shareBatchId),
      );

      const deletedUrls: string[] = [];
      const fetchSpy = mockS3Fetch({
        headSizeFor: headSizeByVariant,
        onDelete: (url) => deletedUrls.push(url),
      });

      try {
        const completed = await owner.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          objectKey: prepared.target.objectKey,
          ...(prepared.previewTarget
            ? { previewObjectKey: prepared.previewTarget.objectKey }
            : {}),
          ...(prepared.pairedVideoTarget
            ? { pairedVideoObjectKey: prepared.pairedVideoTarget.objectKey }
            : {}),
        });

        await owner.user.action(api.assets.deleteDraftAsset, {
          assetId: completed.assetId as Id<'assets'>,
        });
      } finally {
        fetchSpy.mockRestore();
      }

      expect(deletedUrls.some((url) => url.includes('/paired/'))).toBe(true);
      expect(await readOwnerStorageUsage(t, owner.viewer._id)).toBe(0);
    });
  });
});
