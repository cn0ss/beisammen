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
import { CLOUD_PLAN_QUOTAS } from './lib/billing/plans';
import { MAX_PREVIEW_SIZE_BYTES, MAX_UPLOAD_SIZE_BYTES } from './lib/uploadLimits';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

const DECLARED_SIZE_BYTES = 4096;
const DECLARED_PREVIEW_SIZE_BYTES = 512;

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
): Promise<{ user: TestUser; viewer: Doc<'users'> }> {
  const user = t.withIdentity(clerkIdentity(email, displayName));
  const result = await user.mutation(api.users.upsertFromIdentity, {
    email,
    displayName,
  });

  if (typeof result !== 'object' || result === null || !('_id' in result)) {
    throw new Error('Expected upsertFromIdentity to return a viewer record.');
  }

  return { user, viewer: result as Doc<'users'> };
}

async function createCircleFor(
  t: TestDb,
  email: string,
): Promise<{ user: TestUser; viewer: Doc<'users'>; circleId: Id<'circles'> }> {
  const { user, viewer } = await upsertViewer(t, email);
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

interface UploadEnvOptions {
  billingConfigured?: boolean;
  deploymentKind?: 'cloud' | 'self-hosted';
}

async function withUploadEnv<T>(
  options: UploadEnvOptions,
  run: () => Promise<T>,
): Promise<T> {
  const savedEnv: Record<string, string | undefined> = {
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
    PUBLIC_DEPLOYMENT_KIND: process.env.PUBLIC_DEPLOYMENT_KIND,
  };

  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.S3_BUCKET = 'media-bucket';

  if (options.billingConfigured) {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'rc_webhook_test_secret';
  } else {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
  }

  if (options.deploymentKind) {
    process.env.PUBLIC_DEPLOYMENT_KIND = options.deploymentKind;
  } else {
    delete process.env.PUBLIC_DEPLOYMENT_KIND;
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

function createTargetArgs(
  circleId: Id<'circles'>,
  shareBatchId: Id<'shareBatches'>,
  overrides: Partial<{ sizeBytes: number; previewSizeBytes: number }> = {},
) {
  return {
    circleId,
    shareBatchId,
    kind: 'image' as const,
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    sizeBytes: DECLARED_SIZE_BYTES,
    previewSizeBytes: DECLARED_PREVIEW_SIZE_BYTES,
    ...overrides,
  };
}

async function seedOwnerStorageUsage(
  t: TestDb,
  ownerId: Id<'users'>,
  totalBytes: number,
): Promise<void> {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query('billingStorage')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { totalBytes });
    } else {
      await ctx.db.insert('billingStorage', { ownerId, totalBytes });
    }
  });
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
}): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === 'DELETE') {
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

describe('upload size declaration validation', () => {
  test('createTarget rejects missing and absurd declared sizes', async () => {
    await withUploadEnv({ billingConfigured: false }, async () => {
      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);
      const baseArgs = createTargetArgs(owner.circleId, shareBatchId);

      // Missing declared sizes fail argument validation.
      const { sizeBytes: _s, previewSizeBytes: _p, ...withoutSizes } = baseArgs;
      await expect(
        owner.user.action(
          api.uploads.createTarget,
          withoutSizes as unknown as typeof baseArgs,
        ),
      ).rejects.toThrow(/sizeBytes/);

      await expect(
        owner.user.action(api.uploads.createTarget, { ...baseArgs, sizeBytes: 0 }),
      ).rejects.toThrow(/positive integer/);
      await expect(
        owner.user.action(api.uploads.createTarget, { ...baseArgs, sizeBytes: -100 }),
      ).rejects.toThrow(/positive integer/);
      await expect(
        owner.user.action(api.uploads.createTarget, { ...baseArgs, sizeBytes: 1.5 }),
      ).rejects.toThrow(/positive integer/);
      await expect(
        owner.user.action(api.uploads.createTarget, {
          ...baseArgs,
          sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1,
        }),
      ).rejects.toThrow(/exceeds the maximum/);
      await expect(
        owner.user.action(api.uploads.createTarget, { ...baseArgs, previewSizeBytes: 0 }),
      ).rejects.toThrow(/positive integer/);
      await expect(
        owner.user.action(api.uploads.createTarget, {
          ...baseArgs,
          previewSizeBytes: MAX_PREVIEW_SIZE_BYTES + 1,
        }),
      ).rejects.toThrow(/exceeds the maximum/);
    });
  });

  test('image upload targets validate the declared size', async () => {
    await withUploadEnv({ billingConfigured: false }, async () => {
      const t = createTestDb();
      const { user } = await upsertViewer(t, 'avatar@example.com');

      await expect(
        user.action(api.users.createProfileImageTarget, {
          mimeType: 'image/jpeg',
          fileName: 'avatar.jpg',
          sizeBytes: 0,
        }),
      ).rejects.toThrow(/positive integer/);

      const prepared = await user.action(api.users.createProfileImageTarget, {
        mimeType: 'image/jpeg',
        fileName: 'avatar.jpg',
        sizeBytes: 2048,
      });

      expect(prepared.target.headers?.['content-length']).toBe('2048');
      expect(prepared.target.uploadUrl).toContain('content-length%3Bcontent-type%3Bhost');
    });
  });
});

describe('quota enforcement with declared sizes', () => {
  test('createTarget requires storage headroom for the full declared payload', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);
      const quota = CLOUD_PLAN_QUOTAS.cloud_plus.storageBytes;

      // Leave less headroom than the declared payload needs.
      await seedOwnerStorageUsage(
        t,
        owner.viewer._id,
        quota - (DECLARED_SIZE_BYTES + DECLARED_PREVIEW_SIZE_BYTES) + 1,
      );

      await expect(
        owner.user.action(
          api.uploads.createTarget,
          createTargetArgs(owner.circleId, shareBatchId),
        ),
      ).rejects.toThrow(/quota/);

      // With exactly enough headroom the same declaration is accepted.
      await seedOwnerStorageUsage(
        t,
        owner.viewer._id,
        quota - (DECLARED_SIZE_BYTES + DECLARED_PREVIEW_SIZE_BYTES),
      );

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        createTargetArgs(owner.circleId, shareBatchId),
      );

      expect(prepared.target.headers?.['content-length']).toBe(
        String(DECLARED_SIZE_BYTES),
      );
      expect(prepared.target.uploadUrl).toContain(
        'content-length%3Bcontent-type%3Bhost',
      );
      expect(prepared.previewTarget?.headers?.['content-length']).toBe(
        String(DECLARED_PREVIEW_SIZE_BYTES),
      );
    });
  });

  test('adjustUsage enforces the storage cap atomically', async () => {
    const t = createTestDb();
    const { viewer } = await upsertViewer(t, 'cap@example.com');

    await seedOwnerStorageUsage(t, viewer._id, 90);

    await expect(
      t.mutation(internal.billingUsage.adjustUsage, {
        ownerId: viewer._id,
        mediaUploadsDelta: 0,
        storageBytesDelta: 20,
        maxStorageBytes: 100,
      }),
    ).rejects.toThrow(/quota .* exhausted|quota for this feature is exhausted/);

    expect(await readOwnerStorageUsage(t, viewer._id)).toBe(90);

    await t.mutation(internal.billingUsage.adjustUsage, {
      ownerId: viewer._id,
      mediaUploadsDelta: 0,
      storageBytesDelta: 10,
      maxStorageBytes: 100,
    });

    expect(await readOwnerStorageUsage(t, viewer._id)).toBe(100);

    // Without a cap the mutation keeps its unrestricted legacy behavior.
    await t.mutation(internal.billingUsage.adjustUsage, {
      ownerId: viewer._id,
      mediaUploadsDelta: 0,
      storageBytesDelta: 50,
    });

    expect(await readOwnerStorageUsage(t, viewer._id)).toBe(150);
  });

  test('complete refuses to charge past the plan cap and refunds cleanly', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);
      const quota = CLOUD_PLAN_QUOTAS.cloud_plus.storageBytes;

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        createTargetArgs(owner.circleId, shareBatchId),
      );

      // The parallel-complete race: usage grows past the headroom AFTER the
      // target was authorized but BEFORE this upload is charged.
      const seededUsage = quota - DECLARED_SIZE_BYTES + 1;
      await seedOwnerStorageUsage(t, owner.viewer._id, seededUsage);

      const fetchSpy = mockS3Fetch({
        headSizeFor: (url) =>
          url.includes('previews')
            ? DECLARED_PREVIEW_SIZE_BYTES
            : DECLARED_SIZE_BYTES,
      });

      try {
        await expect(
          owner.user.action(api.uploads.complete, {
            uploadId: prepared.uploadId,
            objectKey: prepared.target.objectKey,
          }),
        ).rejects.toThrow(/quota for this feature is exhausted/);
      } finally {
        fetchSpy.mockRestore();
      }

      // The storage gauge is untouched and the media upload charge was
      // refunded, so usage records stay consistent.
      expect(await readOwnerStorageUsage(t, owner.viewer._id)).toBe(seededUsage);

      const usage = await t.query(internal.billingUsage.getUsageForOwner, {
        ownerId: owner.viewer._id,
      });
      expect(usage.uploadCount).toBe(0);

      const upload = await t.run(async (ctx) => await ctx.db.get(prepared.uploadId));
      expect(upload?.status).not.toBe('uploaded');
      expect(upload?.assetId).toBeUndefined();
    });
  });
});

describe('completion size verification', () => {
  test('complete rejects a server-observed size mismatch and deletes the objects', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        createTargetArgs(owner.circleId, shareBatchId),
      );

      const deletedUrls: string[] = [];
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === 'DELETE') {
            deletedUrls.push(String(input));
            return new Response(null, { status: 204 });
          }

          // The stored object is much larger than declared.
          return new Response(null, {
            status: 200,
            headers: { 'content-length': '999999' },
          });
        });

      try {
        await expect(
          owner.user.action(api.uploads.complete, {
            uploadId: prepared.uploadId,
            objectKey: prepared.target.objectKey,
          }),
        ).rejects.toThrow(/does not match the declared upload size/);
      } finally {
        fetchSpy.mockRestore();
      }

      expect(deletedUrls.length).toBeGreaterThanOrEqual(1);

      const upload = await t.run(async (ctx) => await ctx.db.get(prepared.uploadId));
      expect(upload?.status).toBe('failed');
      expect(upload?.failureReason).toMatch(/does not match/);
      expect(await readOwnerStorageUsage(t, owner.viewer._id)).toBe(0);
    });
  });

  test('complete accepts matching sizes and charges the observed bytes', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        createTargetArgs(owner.circleId, shareBatchId),
      );

      const fetchSpy = mockS3Fetch({
        headSizeFor: (url) =>
          url.includes('previews')
            ? DECLARED_PREVIEW_SIZE_BYTES
            : DECLARED_SIZE_BYTES,
      });

      try {
        const completed = await owner.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          objectKey: prepared.target.objectKey,
          ...(prepared.previewTarget
            ? { previewObjectKey: prepared.previewTarget.objectKey }
            : {}),
          fileName: 'photo.jpg',
        });

        expect(completed.assetId).toBeDefined();
      } finally {
        fetchSpy.mockRestore();
      }

      expect(await readOwnerStorageUsage(t, owner.viewer._id)).toBe(
        DECLARED_SIZE_BYTES,
      );

      const upload = await t.run(async (ctx) => await ctx.db.get(prepared.uploadId));
      expect(upload?.status).toBe('uploaded');
    });
  });
});

describe('retry size reuse', () => {
  test('retry reuses the stored declared sizes for both targets', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const prepared = await owner.user.action(
        api.uploads.createTarget,
        createTargetArgs(owner.circleId, shareBatchId, {
          sizeBytes: 8192,
          previewSizeBytes: 1024,
        }),
      );

      const retried = await owner.user.action(api.uploads.retry, {
        uploadId: prepared.uploadId,
      });

      expect(retried.uploadId).toBe(prepared.uploadId);
      expect(retried.target.headers?.['content-length']).toBe('8192');
      expect(retried.target.objectKey).toBe(prepared.target.objectKey);
      expect(retried.previewTarget?.headers?.['content-length']).toBe('1024');

      const upload = await t.run(async (ctx) => await ctx.db.get(prepared.uploadId));
      expect(upload?.declaredSizeBytes).toBe(8192);
      expect(upload?.declaredPreviewSizeBytes).toBe(1024);
    });
  });

  test('legacy uploads without declared sizes cannot be retried', async () => {
    await withUploadEnv({ billingConfigured: true }, async () => {
      mockEntitledTier('cloud_plus');

      const t = createTestDb();
      const owner = await createCircleFor(t, 'owner@example.com');
      const shareBatchId = await createDraftFor(owner.user, owner.circleId);

      const legacyUploadId = await t.run(async (ctx) => {
        return await ctx.db.insert('uploads', {
          shareBatchId,
          circleId: owner.circleId,
          createdBy: owner.viewer._id,
          providerKind: 's3',
          kind: 'image',
          fileName: 'legacy.jpg',
          mimeType: 'image/jpeg',
          status: 'failed',
          createdAt: Date.now(),
        });
      });

      await expect(
        owner.user.action(api.uploads.retry, { uploadId: legacyUploadId }),
      ).rejects.toThrow(/cannot be retried/);
    });
  });
});

describe('self-hosted deployments', () => {
  test('createTarget skips quota but still signs the declared sizes', async () => {
    await withUploadEnv(
      { billingConfigured: false, deploymentKind: 'self-hosted' },
      async () => {
        const t = createTestDb();
        const owner = await createCircleFor(t, 'owner@example.com');
        const shareBatchId = await createDraftFor(owner.user, owner.circleId);

        const prepared = await owner.user.action(
          api.uploads.createTarget,
          createTargetArgs(owner.circleId, shareBatchId),
        );

        expect(prepared.target.headers?.['content-length']).toBe(
          String(DECLARED_SIZE_BYTES),
        );
        expect(prepared.target.uploadUrl).toContain(
          'content-length%3Bcontent-type%3Bhost',
        );
        expect(prepared.previewTarget?.headers?.['content-length']).toBe(
          String(DECLARED_PREVIEW_SIZE_BYTES),
        );

        // Declared bounds still apply without billing.
        await expect(
          owner.user.action(
            api.uploads.createTarget,
            createTargetArgs(owner.circleId, shareBatchId, {
              sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1,
            }),
          ),
        ).rejects.toThrow(/exceeds the maximum/);
      },
    );
  });
});
