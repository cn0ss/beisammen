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

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

const CLERK_TEST_ISSUER = 'https://test.clerk.accounts.dev';
const TEST_BUCKET = 'legacy-migration-bucket';

function createTestDb() {
  return convexTest(schema, modules);
}

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
): Promise<{ user: TestUser; viewer: Doc<'users'> }> {
  const user = t.withIdentity(clerkIdentity(email));
  const result = await user.mutation(api.users.upsertFromIdentity, {
    email,
    displayName: email,
  });

  if (typeof result !== 'object' || result === null || !('_id' in result)) {
    throw new Error('Expected upsertFromIdentity to return a viewer record.');
  }

  return { user, viewer: result as Doc<'users'> };
}

async function withS3Env<T>(run: () => Promise<T>): Promise<T> {
  const savedEnv: Record<string, string | undefined> = {
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
  };

  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.S3_BUCKET = TEST_BUCKET;

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

interface SeededLegacyData {
  user: TestUser;
  viewerId: Id<'users'>;
  circleId: Id<'circles'>;
  assetId: Id<'assets'>;
  uploadId: Id<'uploads'>;
  imageUploadId: Id<'imageUploads'>;
  profileImageStorageId: Id<'_storage'>;
  assetStorageId: Id<'_storage'>;
  circleImageStorageId: Id<'_storage'>;
  imageUploadStorageId: Id<'_storage'>;
}

async function seedLegacyData(t: TestDb): Promise<SeededLegacyData> {
  const { user, viewer } = await upsertViewer(t, 'legacy@example.com');
  const created = await user.mutation(api.circles.create, {
    name: 'Legacy circle',
  });
  const circleId = created.circleId as Id<'circles'>;

  const seededIds = await t.run(async (ctx) => {
    const now = Date.now();
    const profileImageStorageId = await ctx.storage.store(
      new Blob(['profile-bytes'], { type: 'image/jpeg' }),
    );
    const assetStorageId = await ctx.storage.store(
      new Blob(['asset-bytes'], { type: 'image/jpeg' }),
    );
    const circleImageStorageId = await ctx.storage.store(
      new Blob(['circle-bytes'], { type: 'image/jpeg' }),
    );
    const imageUploadStorageId = await ctx.storage.store(
      new Blob(['image-upload-bytes'], { type: 'image/jpeg' }),
    );

    await ctx.db.patch(viewer._id, {
      profileImageStorage: {
        provider: 'convex-files',
        storageId: profileImageStorageId,
      },
    });
    await ctx.db.patch(circleId, {
      imageStorage: {
        provider: 'convex-files',
        storageId: circleImageStorageId,
      },
    });

    const shareBatchId = await ctx.db.insert('shareBatches', {
      circleId,
      authorId: viewer._id,
      assetCount: 1,
      status: 'published',
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    });
    const assetId = await ctx.db.insert('assets', {
      shareBatchId,
      circleId,
      kind: 'image',
      fileName: 'legacy.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 11,
      storage: {
        provider: 'convex-files',
        storageId: assetStorageId,
      },
      createdAt: now,
    });
    // The upload row shares the asset's blob, mirroring how completed legacy
    // uploads were written: one Convex blob referenced from both rows.
    const uploadId = await ctx.db.insert('uploads', {
      shareBatchId,
      circleId,
      createdBy: viewer._id,
      assetId,
      providerKind: 'convex-files',
      kind: 'image',
      fileName: 'legacy.jpg',
      mimeType: 'image/jpeg',
      storage: {
        provider: 'convex-files',
        storageId: assetStorageId,
      },
      status: 'uploaded',
      createdAt: now,
      completedAt: now,
    });
    const imageUploadId = await ctx.db.insert('imageUploads', {
      targetKind: 'user-profile',
      userId: viewer._id,
      providerKind: 'convex-files',
      fileName: 'avatar.jpg',
      mimeType: 'image/jpeg',
      storage: {
        provider: 'convex-files',
        storageId: imageUploadStorageId,
      },
      status: 'uploaded',
      createdAt: now,
      completedAt: now,
    });

    return {
      assetId,
      uploadId,
      imageUploadId,
      profileImageStorageId,
      assetStorageId,
      circleImageStorageId,
      imageUploadStorageId,
    };
  });

  return {
    user,
    viewerId: viewer._id,
    circleId,
    ...seededIds,
  };
}

function mockS3Fetch(): { spy: ReturnType<typeof vi.spyOn>; putUrls: string[] } {
  const putUrls: string[] = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (!url.includes(`/${TEST_BUCKET}/`)) {
        throw new Error(`Unexpected fetch in legacyStorage tests: ${url}`);
      }

      if (init?.method === 'PUT') {
        putUrls.push(url);
        return new Response(null, { status: 200 });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      return new Response(null, {
        status: 200,
        headers: { 'content-length': '11' },
      });
    });

  return { spy, putUrls };
}

describe('legacyStorage.countLegacyRows', () => {
  test('counts legacy convex-files references per table', async () => {
    const t = createTestDb();
    await seedLegacyData(t);

    const counts = await t.query(internal.legacyStorage.countLegacyRows, {});

    expect(counts).toMatchObject({
      assets: { legacyReferences: 1, isTruncated: false },
      uploads: { legacyReferences: 1, isTruncated: false },
      imageUploads: { legacyReferences: 1, isTruncated: false },
      users: { legacyReferences: 1, isTruncated: false },
      circles: { legacyReferences: 1, isTruncated: false },
    });
  });

  test('reports zero everywhere for s3-only data', async () => {
    const t = createTestDb();
    await upsertViewer(t, 'clean@example.com');

    const counts = await t.query(internal.legacyStorage.countLegacyRows, {});

    for (const table of ['assets', 'uploads', 'imageUploads', 'users', 'circles'] as const) {
      expect(counts[table]).toMatchObject({ legacyReferences: 0, isTruncated: false });
    }
  });
});

describe('legacyStorage.migrateBatch', () => {
  test('moves legacy blobs to S3, patches every referencing row, and deletes the blobs', async () => {
    await withS3Env(async () => {
      const t = createTestDb();
      const seeded = await seedLegacyData(t);
      const { spy, putUrls } = mockS3Fetch();

      try {
        const result = await t.action(internal.legacyStorage.migrateBatch, {});

        // Four unique blobs; the asset and its upload row share one of them,
        // so five references were patched from four uploads to S3.
        expect(result).toMatchObject({
          migrated: 4,
          referencesPatched: 5,
          failed: [],
          hasMore: false,
          scanTruncated: false,
        });
        expect(putUrls).toHaveLength(4);

        const expectedAssetKey = `legacy/convex-files/${seeded.assetStorageId}`;

        await t.run(async (ctx) => {
          const user = await ctx.db.get(seeded.viewerId);
          expect(user?.profileImageStorage).toMatchObject({
            provider: 's3',
            bucket: TEST_BUCKET,
            objectKey: `legacy/convex-files/${seeded.profileImageStorageId}`,
          });

          const circle = await ctx.db.get(seeded.circleId);
          expect(circle?.imageStorage).toMatchObject({
            provider: 's3',
            objectKey: `legacy/convex-files/${seeded.circleImageStorageId}`,
          });

          const asset = await ctx.db.get(seeded.assetId);
          expect(asset?.storage).toMatchObject({
            provider: 's3',
            objectKey: expectedAssetKey,
          });

          const upload = await ctx.db.get(seeded.uploadId);
          expect(upload?.storage).toMatchObject({
            provider: 's3',
            objectKey: expectedAssetKey,
          });

          const imageUpload = await ctx.db.get(seeded.imageUploadId);
          expect(imageUpload?.storage).toMatchObject({
            provider: 's3',
            objectKey: `legacy/convex-files/${seeded.imageUploadStorageId}`,
          });

          // The Convex blobs were deleted after the move.
          for (const storageId of [
            seeded.profileImageStorageId,
            seeded.assetStorageId,
            seeded.circleImageStorageId,
            seeded.imageUploadStorageId,
          ]) {
            expect(await ctx.storage.getUrl(storageId)).toBeNull();
          }
        });

        const counts = await t.query(internal.legacyStorage.countLegacyRows, {});

        for (const table of ['assets', 'uploads', 'imageUploads', 'users', 'circles'] as const) {
          expect(counts[table]).toMatchObject({ legacyReferences: 0 });
        }

        // Re-running is a no-op once everything is migrated.
        await expect(t.action(internal.legacyStorage.migrateBatch, {})).resolves.toMatchObject({
          migrated: 0,
          referencesPatched: 0,
          failed: [],
          hasMore: false,
        });
      } finally {
        spy.mockRestore();
      }
    });
  });

  test('reports failures without deleting the blob when the S3 upload fails', async () => {
    await withS3Env(async () => {
      const t = createTestDb();
      const seeded = await seedLegacyData(t);
      const spy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 500 }));

      try {
        const result = await t.action(internal.legacyStorage.migrateBatch, { batchSize: 25 });

        expect(result.migrated).toBe(0);
        expect(result.failed.length).toBeGreaterThan(0);
        expect(result.hasMore).toBe(true);

        await t.run(async (ctx) => {
          // Nothing was patched and the blob is still there.
          const asset = await ctx.db.get(seeded.assetId);
          expect(asset?.storage.provider).toBe('convex-files');
          expect(await ctx.storage.getUrl(seeded.assetStorageId)).not.toBeNull();
        });
      } finally {
        spy.mockRestore();
      }
    });
  });
});
