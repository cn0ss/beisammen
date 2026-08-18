/// <reference types="vite/client" />

import { convexTest, type TestConvex } from 'convex-test';
import type { UserIdentity } from 'convex/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('convex-revenuecat', async () => {
  const { httpActionGeneric } = await import('convex/server');

  return {
    RevenueCat: vi.fn(function RevenueCatMock() {
      return {
        hasEntitlement: vi.fn(),
        getActiveSubscriptions: vi.fn(),
        getCustomer: vi.fn(),
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
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type TestDb = TestConvex<typeof schema>;
type TestUser = ReturnType<TestDb['withIdentity']>;

const DECLARED_SIZE_BYTES = 4096;
const DECLARED_PREVIEW_SIZE_BYTES = 512;
const CLERK_TEST_ISSUER = 'https://test.clerk.accounts.dev';

/** Deterministic base64 of exactly `byteLength` bytes, varying with `seed`. */
function base64OfBytes(byteLength: number, seed: string): string {
  let hash = 7;

  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  const bytes = Array.from({ length: byteLength }, (_, index) => (hash + index * 13) % 256);

  return btoa(String.fromCharCode(...bytes));
}

/** Valid-shaped sealed circle key (48-byte seal overhead + 32-byte key). */
const fakeSealedKey = (seed: string) => base64OfBytes(80, seed);

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

async function upsertViewer(
  t: TestDb,
  email: string,
): Promise<{ user: TestUser; viewer: Doc<'users'> }> {
  const user = t.withIdentity(clerkIdentity(email));
  const viewer = (await user.mutation(api.users.upsertFromIdentity, {
    email,
    displayName: email,
  })) as Doc<'users'>;

  return { user, viewer };
}

async function withSelfHostedS3Env<T>(run: () => Promise<T>): Promise<T> {
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
  process.env.PUBLIC_DEPLOYMENT_KIND = 'self-hosted';
  delete process.env.REVENUECAT_WEBHOOK_AUTH;

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

function mockS3Fetch(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      return new Response(null, {
        status: 200,
        headers: {
          'content-length': url.includes('-preview')
            ? String(DECLARED_PREVIEW_SIZE_BYTES)
            : String(DECLARED_SIZE_BYTES),
        },
      });
    },
  );
}

interface PreparedUpload {
  user: TestUser;
  viewer: Doc<'users'>;
  circleId: Id<'circles'>;
  shareBatchId: Id<'shareBatches'>;
  uploadId: Id<'uploads'>;
  previewObjectKey: string;
}

async function prepareUpload(t: TestDb, email: string): Promise<PreparedUpload> {
  const { user, viewer } = await upsertViewer(t, email);
  const created = await user.mutation(api.circles.create, { name: 'Family' });
  const circleId = created.circleId as Id<'circles'>;
  const draft = await user.mutation(api.shares.getOrCreateDraft, { circleId });
  const shareBatchId = draft.shareBatchId as Id<'shareBatches'>;
  const target = await user.action(api.uploads.createTarget, {
    circleId,
    shareBatchId,
    kind: 'image' as const,
    mimeType: 'image/jpeg',
    fileName: 'media.bin',
    sizeBytes: DECLARED_SIZE_BYTES,
    previewSizeBytes: DECLARED_PREVIEW_SIZE_BYTES,
  });

  return {
    user,
    viewer,
    circleId,
    shareBatchId,
    uploadId: target.uploadId as Id<'uploads'>,
    previewObjectKey: (target as { previewTarget: { objectKey: string } }).previewTarget
      .objectKey,
  };
}

function encryptionEnvelope(overrides: Partial<{
  circleEpoch: number;
  wrappedFileKey: string;
  encMetadata: string;
}> = {}) {
  return {
    v: 1 as const,
    circleEpoch: 1,
    wrappedFileKey: 'wrapped_file_key_base64',
    encMetadata: 'enc_metadata_base64',
    ...overrides,
  };
}

describe('asset encryption envelope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('complete stores the envelope and read surfaces expose it', async () => {
    await withSelfHostedS3Env(async () => {
      const t = convexTest(schema, modules);
      const prepared = await prepareUpload(t, 'owner@example.com');

      await prepared.user.mutation(api.keys.initializeCircleKey, {
        circleId: prepared.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      });
      mockS3Fetch();

      const completed = await prepared.user.action(api.uploads.complete, {
        uploadId: prepared.uploadId,
        previewObjectKey: prepared.previewObjectKey,
        width: 100,
        height: 100,
        capturedAt: 1_700_000_000_000,
        encryption: encryptionEnvelope(),
      });
      const asset = await t.run(async (ctx) => await ctx.db.get(completed.assetId));

      expect(asset?.encryption).toEqual(encryptionEnvelope());
      expect(asset?.location).toBeUndefined();

      const listed = await prepared.user.query(api.assets.listForShareBatch, {
        shareBatchId: prepared.shareBatchId,
      });

      expect(listed[0]?.encryption).toEqual(encryptionEnvelope());
    });
  });

  test('complete rejects plaintext location next to an encrypted envelope', async () => {
    await withSelfHostedS3Env(async () => {
      const t = convexTest(schema, modules);
      const prepared = await prepareUpload(t, 'owner@example.com');

      await prepared.user.mutation(api.keys.initializeCircleKey, {
        circleId: prepared.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      });
      mockS3Fetch();

      await expect(
        prepared.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          previewObjectKey: prepared.previewObjectKey,
          encryption: encryptionEnvelope(),
          location: {
            latitude: 48.1,
            longitude: 11.5,
            source: 'embedded' as const,
          },
        }),
      ).rejects.toThrow(/must not include a plaintext location/i);
    });
  });

  test('complete rejects unknown epochs and empty wrapped keys', async () => {
    await withSelfHostedS3Env(async () => {
      const t = convexTest(schema, modules);
      const prepared = await prepareUpload(t, 'owner@example.com');

      mockS3Fetch();

      await expect(
        prepared.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          previewObjectKey: prepared.previewObjectKey,
          encryption: encryptionEnvelope(),
        }),
      ).rejects.toThrow(/unknown circle key epoch/i);

      await prepared.user.mutation(api.keys.initializeCircleKey, {
        circleId: prepared.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      });

      await expect(
        prepared.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          previewObjectKey: prepared.previewObjectKey,
          encryption: encryptionEnvelope({ wrappedFileKey: '   ' }),
        }),
      ).rejects.toThrow(/wrappedFileKey is required/i);
    });
  });

  test('listMetadataForCircle is member-gated and hides foreign drafts', async () => {
    await withSelfHostedS3Env(async () => {
      const t = convexTest(schema, modules);
      const prepared = await prepareUpload(t, 'owner@example.com');
      const { user: outsider } = await upsertViewer(t, 'outsider@example.com');
      const { user: member, viewer: memberViewer } = await upsertViewer(
        t,
        'member@example.com',
      );

      await t.run(async (ctx) => {
        await ctx.db.insert('circleMembers', {
          circleId: prepared.circleId,
          userId: memberViewer._id,
          role: 'member',
          joinedAt: Date.now(),
        });
      });
      await prepared.user.mutation(api.keys.initializeCircleKey, {
        circleId: prepared.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      });
      mockS3Fetch();
      await prepared.user.action(api.uploads.complete, {
        uploadId: prepared.uploadId,
        previewObjectKey: prepared.previewObjectKey,
        encryption: encryptionEnvelope(),
      });

      await expect(
        outsider.query(api.assets.listMetadataForCircle, {
          circleId: prepared.circleId,
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).rejects.toThrow(/membership required/i);

      // The draft asset belongs to the owner, so co-members do not see it yet.
      const memberView = await member.query(api.assets.listMetadataForCircle, {
        circleId: prepared.circleId,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(memberView.page).toHaveLength(0);

      const ownerView = await prepared.user.query(api.assets.listMetadataForCircle, {
        circleId: prepared.circleId,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(ownerView.page).toHaveLength(1);
      expect(ownerView.page[0]).toMatchObject({ encryption: encryptionEnvelope() });
      expect(ownerView.page[0]?.location).toBeUndefined();
    });
  });

  test('complete rejects stale epochs after a rotation', async () => {
    await withSelfHostedS3Env(async () => {
      const t = convexTest(schema, modules);
      const prepared = await prepareUpload(t, 'owner@example.com');

      await prepared.user.mutation(api.keys.initializeCircleKey, {
        circleId: prepared.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      });
      await prepared.user.mutation(api.keys.rotateCircleKey, {
        circleId: prepared.circleId,
        grants: [{ userId: prepared.viewer._id, sealedCircleKey: fakeSealedKey('owner_e2') }],
      });
      mockS3Fetch();

      // Epoch 1 still exists for old assets, but new media must use epoch 2:
      // an older epoch may be held by since-departed members.
      await expect(
        prepared.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          previewObjectKey: prepared.previewObjectKey,
          encryption: encryptionEnvelope({ circleEpoch: 1 }),
        }),
      ).rejects.toThrow(/stale circle key epoch/i);

      const completed = await prepared.user.action(api.uploads.complete, {
        uploadId: prepared.uploadId,
        previewObjectKey: prepared.previewObjectKey,
        encryption: encryptionEnvelope({ circleEpoch: 2 }),
      });

      expect(completed.assetId).toBeDefined();
    });
  });

  test('complete is blocked while a departure keeps rotation pending', async () => {
    await withSelfHostedS3Env(async () => {
      const t = convexTest(schema, modules);
      const prepared = await prepareUpload(t, 'owner@example.com');
      const { viewer: memberViewer } = await upsertViewer(t, 'member@example.com');

      const membershipId = await t.run(async (ctx) => {
        return await ctx.db.insert('circleMembers', {
          circleId: prepared.circleId,
          userId: memberViewer._id,
          role: 'member',
          joinedAt: Date.now(),
        });
      });

      await prepared.user.mutation(api.keys.initializeCircleKey, {
        circleId: prepared.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      });
      await prepared.user.mutation(api.circles.removeMember, {
        circleId: prepared.circleId,
        memberId: membershipId,
      });
      mockS3Fetch();

      // The removed member may still hold epoch 1; encrypted publishing stays
      // blocked until a fresh epoch is committed.
      await expect(
        prepared.user.action(api.uploads.complete, {
          uploadId: prepared.uploadId,
          previewObjectKey: prepared.previewObjectKey,
          encryption: encryptionEnvelope(),
        }),
      ).rejects.toThrow(/rotated after a member departure/i);

      await prepared.user.mutation(api.keys.rotateCircleKey, {
        circleId: prepared.circleId,
        grants: [{ userId: prepared.viewer._id, sealedCircleKey: fakeSealedKey('owner_e2') }],
      });

      const completed = await prepared.user.action(api.uploads.complete, {
        uploadId: prepared.uploadId,
        previewObjectKey: prepared.previewObjectKey,
        encryption: encryptionEnvelope({ circleEpoch: 2 }),
      });

      expect(completed.assetId).toBeDefined();
    });
  });
});
