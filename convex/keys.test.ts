/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import type { UserIdentity } from 'convex/server';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
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

/** Deterministic base64 of exactly `byteLength` bytes, varying with `seed`. */
function base64OfBytes(byteLength: number, seed: string): string {
  let hash = 7;

  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  const bytes = Array.from({ length: byteLength }, (_, index) => (hash + index * 13) % 256);

  return btoa(String.fromCharCode(...bytes));
}

/** Valid-shaped X25519 public key (32 bytes). */
const fakePublicKey = (seed: string) => base64OfBytes(32, `pk_${seed}`);
/** Valid-shaped sealed circle key (48-byte seal overhead + 32-byte key). */
const fakeSealedKey = (seed: string) => base64OfBytes(80, `sealed_${seed}`);

function fakeRegistration(seed: string) {
  return {
    keyVersion: 1,
    publicKey: fakePublicKey(seed),
    encPrivateKey: `enc_priv_${seed}`,
    encMasterKeyByRecovery: `enc_master_${seed}`,
    encRecoveryKeyByMaster: `enc_recovery_${seed}`,
  };
}

type Harness = ReturnType<typeof convexTest>;
type Actor = ReturnType<Harness['withIdentity']>;

async function signUp(t: Harness, email: string): Promise<{ actor: Actor; viewer: Doc<'users'> }> {
  const actor = t.withIdentity(clerkIdentity(email));
  const viewer = (await actor.mutation(api.users.upsertFromIdentity, {
    email,
    displayName: email,
  })) as Doc<'users'>;

  return { actor, viewer };
}

async function addMember(
  t: Harness,
  circleId: Id<'circles'>,
  userId: Id<'users'>,
  role: 'admin' | 'member' = 'member',
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('circleMembers', {
      circleId,
      userId,
      role,
      joinedAt: Date.now(),
    });
  });
}

describe('user key registration', () => {
  test('registers once, reads back, and stays idempotent for identical keys', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'ada@example.com');

    expect(await actor.query(api.keys.getMyKeys, {})).toBeNull();

    const registration = fakeRegistration('ada');

    await expect(actor.mutation(api.keys.registerKeys, registration)).resolves.toEqual({
      created: true,
    });
    await expect(actor.mutation(api.keys.registerKeys, registration)).resolves.toEqual({
      created: false,
    });

    const stored = await actor.query(api.keys.getMyKeys, {});

    expect(stored).toMatchObject(registration);
  });

  test('rejects replacing registered keys with different ones', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'ada@example.com');

    await actor.mutation(api.keys.registerKeys, fakeRegistration('ada'));
    await expect(
      actor.mutation(api.keys.registerKeys, fakeRegistration('other')),
    ).rejects.toThrow(/already registered/i);
  });

  test('rejects unsupported versions and empty fields', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'ada@example.com');

    await expect(
      actor.mutation(api.keys.registerKeys, { ...fakeRegistration('ada'), keyVersion: 2 }),
    ).rejects.toThrow(/unsupported key version/i);
    await expect(
      actor.mutation(api.keys.registerKeys, { ...fakeRegistration('ada'), publicKey: '  ' }),
    ).rejects.toThrow(/publicKey is required/i);
  });

  test('rejects public keys that are not base64 of exactly 32 bytes', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'ada@example.com');

    // Wrong length (31 bytes), non-base64 payload, and unpadded variants must
    // all be rejected: other members' clients decode this value as canonical
    // X25519 material during grant top-up and rotation.
    for (const publicKey of [
      base64OfBytes(31, 'short'),
      base64OfBytes(33, 'long'),
      'not base64 at all!',
      base64OfBytes(32, 'ok').replace(/=+$/, ''),
    ]) {
      await expect(
        actor.mutation(api.keys.registerKeys, { ...fakeRegistration('ada'), publicKey }),
      ).rejects.toThrow(/publicKey must be base64 of exactly 32 bytes/i);
    }

    await expect(
      actor.mutation(api.keys.registerKeys, fakeRegistration('ada')),
    ).resolves.toEqual({ created: true });
  });
});

describe('key reset', () => {
  test('replaces registered keys and deletes all stale grants', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { actor: member, viewer: memberViewer } = await signUp(t, 'member@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await member.mutation(api.keys.registerKeys, fakeRegistration('member'));
    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });
    await owner.mutation(api.keys.grantCircleKeys, {
      circleId: circle.circleId,
      epoch: 1,
      grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e1') }],
    });

    // Plain re-registration with different keys stays rejected.
    await expect(
      member.mutation(api.keys.registerKeys, fakeRegistration('member_new')),
    ).rejects.toThrow(/already registered/i);

    await expect(
      member.mutation(api.keys.resetKeys, fakeRegistration('member_new')),
    ).resolves.toEqual({ created: false });

    const stored = await member.query(api.keys.getMyKeys, {});

    expect(stored?.publicKey).toBe(fakePublicKey('member_new'));

    // The old grant (sealed to the replaced key) is gone, so the member shows
    // up as missing again and any key holder re-grants automatically.
    const memberKeys = await member.query(api.keys.getMyCircleKeys, {
      circleId: circle.circleId,
    });

    expect(memberKeys.grants).toEqual([]);

    const missing = await owner.query(api.keys.listMissingKeyGrants, {
      circleId: circle.circleId,
    });

    expect(missing.missing).toEqual([
      { userId: memberViewer._id, publicKey: fakePublicKey('member_new') },
    ]);
  });

  test('reset without prior registration registers fresh keys', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'ada@example.com');

    await expect(actor.mutation(api.keys.resetKeys, fakeRegistration('ada'))).resolves.toEqual({
      created: true,
    });
    await expect(actor.query(api.keys.getMyKeys, {})).resolves.toMatchObject({
      publicKey: fakePublicKey('ada'),
    });
  });

  test('reset validates key material like registration', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'ada@example.com');

    await expect(
      actor.mutation(api.keys.resetKeys, {
        ...fakeRegistration('ada'),
        publicKey: 'not base64',
      }),
    ).rejects.toThrow(/publicKey must be base64 of exactly 32 bytes/i);
  });
});

describe('circle key epochs and grants', () => {
  test('initialization creates epoch 1 with a self grant; re-initialization is a no-op', async () => {
    const t = convexTest(schema, modules);
    const { actor } = await signUp(t, 'owner@example.com');
    const circle = await actor.mutation(api.circles.create, { name: 'Familie' });

    await expect(
      actor.mutation(api.keys.initializeCircleKey, {
        circleId: circle.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1'),
      }),
    ).resolves.toEqual({ epoch: 1, created: true });
    await expect(
      actor.mutation(api.keys.initializeCircleKey, {
        circleId: circle.circleId,
        sealedCircleKey: fakeSealedKey('owner_e1_retry'),
      }),
    ).resolves.toEqual({ epoch: 1, created: false });

    const myKeys = await actor.query(api.keys.getMyCircleKeys, { circleId: circle.circleId });

    expect(myKeys.currentEpoch).toBe(1);
    expect(myKeys.rotationPending).toBe(false);
    expect(myKeys.canRotate).toBe(true);
    expect(myKeys.grants).toHaveLength(1);
    expect(myKeys.grants[0]).toMatchObject({
      epoch: 1,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });
  });

  test('non-members cannot touch circle keys', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { actor: outsider } = await signUp(t, 'outsider@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await expect(
      outsider.mutation(api.keys.initializeCircleKey, {
        circleId: circle.circleId,
        sealedCircleKey: fakeSealedKey('outsider_e1'),
      }),
    ).rejects.toThrow(/membership required/i);
    await expect(
      outsider.query(api.keys.getMyCircleKeys, { circleId: circle.circleId }),
    ).rejects.toThrow(/membership required/i);
    await expect(
      outsider.query(api.keys.getCircleMemberPublicKeys, { circleId: circle.circleId }),
    ).rejects.toThrow(/membership required/i);
  });

  test('grants require holding the epoch key and target current members only', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner, viewer: ownerViewer } = await signUp(t, 'owner@example.com');
    const { actor: member, viewer: memberViewer } = await signUp(t, 'member@example.com');
    const { viewer: outsiderViewer } = await signUp(t, 'outsider@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });

    // The member does not hold the key yet, so they cannot grant it.
    await expect(
      member.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch: 1,
        grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('forged') }],
      }),
    ).rejects.toThrow(/holding this circle key/i);

    await expect(
      owner.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch: 1,
        grants: [
          { userId: outsiderViewer._id, sealedCircleKey: fakeSealedKey('outsider_e1') },
        ],
      }),
    ).rejects.toThrow(/current circle members/i);
    await expect(
      owner.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch: 2,
        grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e2') }],
      }),
    ).rejects.toThrow(/unknown circle key epoch/i);

    await expect(
      owner.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch: 1,
        grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e1') }],
      }),
    ).resolves.toEqual({ granted: 1 });
    // Existing grants are skipped instead of overwritten.
    await expect(
      owner.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch: 1,
        grants: [
          { userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e1_other') },
          { userId: ownerViewer._id, sealedCircleKey: fakeSealedKey('owner_e1_other') },
        ],
      }),
    ).resolves.toEqual({ granted: 0 });

    const memberKeys = await member.query(api.keys.getMyCircleKeys, {
      circleId: circle.circleId,
    });

    expect(memberKeys.grants).toEqual([
      expect.objectContaining({ epoch: 1, sealedCircleKey: fakeSealedKey('member_e1') }),
    ]);
  });

  test('grants must be base64 of exactly 80 bytes (sealed 32-byte key)', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { viewer: memberViewer } = await signUp(t, 'member@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });

    for (const sealedCircleKey of ['poisoned', base64OfBytes(79, 'short'), 'x'.repeat(108)]) {
      await expect(
        owner.mutation(api.keys.grantCircleKeys, {
          circleId: circle.circleId,
          epoch: 1,
          grants: [{ userId: memberViewer._id, sealedCircleKey }],
        }),
      ).rejects.toThrow(/sealedCircleKey must be base64 of exactly 80 bytes/i);
    }
  });

  test('a member can reject their own unreadable grant and get a fresh one', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { actor: member, viewer: memberViewer } = await signUp(t, 'member@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await member.mutation(api.keys.registerKeys, fakeRegistration('member'));
    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });
    await owner.mutation(api.keys.grantCircleKeys, {
      circleId: circle.circleId,
      epoch: 1,
      grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('unreadable') }],
    });

    // While the (undecryptable) grant row exists, the member is not missing.
    await expect(
      owner.query(api.keys.listMissingKeyGrants, { circleId: circle.circleId }),
    ).resolves.toMatchObject({ missing: [] });

    await expect(
      member.mutation(api.keys.rejectMyKeyGrant, { circleId: circle.circleId, epoch: 1 }),
    ).resolves.toEqual({ rejected: true });
    await expect(
      member.mutation(api.keys.rejectMyKeyGrant, { circleId: circle.circleId, epoch: 1 }),
    ).resolves.toEqual({ rejected: false });

    const missing = await owner.query(api.keys.listMissingKeyGrants, {
      circleId: circle.circleId,
    });

    expect(missing.missing).toEqual([
      { userId: memberViewer._id, publicKey: fakePublicKey('member') },
    ]);

    await expect(
      owner.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch: 1,
        grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e1') }],
      }),
    ).resolves.toEqual({ granted: 1 });
  });

  test('missing grants are listed with public keys until topped up', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { actor: member, viewer: memberViewer } = await signUp(t, 'member@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);

    await expect(
      owner.query(api.keys.listMissingKeyGrants, { circleId: circle.circleId }),
    ).resolves.toEqual({ currentEpoch: null, missing: [], missingByEpoch: [] });

    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });
    await member.mutation(api.keys.registerKeys, fakeRegistration('member'));

    const before = await owner.query(api.keys.listMissingKeyGrants, {
      circleId: circle.circleId,
    });

    expect(before.currentEpoch).toBe(1);
    expect(before.missing).toEqual([
      { userId: memberViewer._id, publicKey: fakePublicKey('member') },
    ]);

    await owner.mutation(api.keys.grantCircleKeys, {
      circleId: circle.circleId,
      epoch: 1,
      grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e1') }],
    });
    await expect(
      owner.query(api.keys.listMissingKeyGrants, { circleId: circle.circleId }),
    ).resolves.toEqual({ currentEpoch: 1, missing: [], missingByEpoch: [] });
  });

  test('listMissingKeyGrants covers requested older epochs for history top-up', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner, viewer: ownerViewer } = await signUp(t, 'owner@example.com');
    const { viewer: joinerViewer } = await signUp(t, 'joiner@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });
    await owner.mutation(api.keys.rotateCircleKey, {
      circleId: circle.circleId,
      grants: [{ userId: ownerViewer._id, sealedCircleKey: fakeSealedKey('owner_e2') }],
    });
    // The joiner arrives after the rotation and holds nothing yet.
    await addMember(t, circle.circleId, joinerViewer._id);

    const missing = await owner.query(api.keys.listMissingKeyGrants, {
      circleId: circle.circleId,
      epochs: [2, 1],
    });

    expect(missing.currentEpoch).toBe(2);
    expect(missing.missingByEpoch).toEqual([
      { epoch: 2, members: [{ userId: joinerViewer._id, publicKey: null }] },
      { epoch: 1, members: [{ userId: joinerViewer._id, publicKey: null }] },
    ]);
    // The legacy field still reflects the current epoch only.
    expect(missing.missing).toEqual([{ userId: joinerViewer._id, publicKey: null }]);

    // Granting both epochs clears the whole backlog.
    for (const epoch of [1, 2]) {
      await owner.mutation(api.keys.grantCircleKeys, {
        circleId: circle.circleId,
        epoch,
        grants: [
          { userId: joinerViewer._id, sealedCircleKey: fakeSealedKey(`joiner_e${epoch}`) },
        ],
      });
    }

    await expect(
      owner.query(api.keys.listMissingKeyGrants, {
        circleId: circle.circleId,
        epochs: [2, 1],
      }),
    ).resolves.toMatchObject({ missingByEpoch: [] });

    // Unknown and out-of-range epochs are ignored instead of failing.
    await expect(
      owner.query(api.keys.listMissingKeyGrants, {
        circleId: circle.circleId,
        epochs: [99, -1, 1.5],
      }),
    ).resolves.toMatchObject({ currentEpoch: 2 });
  });

  test('rotation needs a manage role, a prior epoch, and a self grant', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner, viewer: ownerViewer } = await signUp(t, 'owner@example.com');
    const { actor: member, viewer: memberViewer } = await signUp(t, 'member@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);

    await expect(
      owner.mutation(api.keys.rotateCircleKey, {
        circleId: circle.circleId,
        grants: [{ userId: ownerViewer._id, sealedCircleKey: fakeSealedKey('owner_e2') }],
      }),
    ).rejects.toThrow(/initialize/i);

    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });

    await expect(
      member.mutation(api.keys.rotateCircleKey, {
        circleId: circle.circleId,
        grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e2') }],
      }),
    ).rejects.toThrow(/owners and admins/i);
    await expect(
      owner.mutation(api.keys.rotateCircleKey, {
        circleId: circle.circleId,
        grants: [{ userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e2') }],
      }),
    ).rejects.toThrow(/grant for the rotating member/i);

    await expect(
      owner.mutation(api.keys.rotateCircleKey, {
        circleId: circle.circleId,
        grants: [
          { userId: ownerViewer._id, sealedCircleKey: fakeSealedKey('owner_e2') },
          { userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e2') },
        ],
      }),
    ).resolves.toEqual({ epoch: 2 });

    const memberKeys = await member.query(api.keys.getMyCircleKeys, {
      circleId: circle.circleId,
    });

    expect(memberKeys.currentEpoch).toBe(2);
    expect(memberKeys.canRotate).toBe(false);
    expect(memberKeys.grants).toEqual([
      expect.objectContaining({ epoch: 2, sealedCircleKey: fakeSealedKey('member_e2') }),
    ]);
  });

  test('member public keys resolve to null until keys are registered', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner, viewer: ownerViewer } = await signUp(t, 'owner@example.com');
    const { viewer: memberViewer } = await signUp(t, 'member@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await owner.mutation(api.keys.registerKeys, fakeRegistration('owner'));

    const members = await owner.query(api.keys.getCircleMemberPublicKeys, {
      circleId: circle.circleId,
    });

    expect(members).toEqual(
      expect.arrayContaining([
        { userId: ownerViewer._id, publicKey: fakePublicKey('owner') },
        { userId: memberViewer._id, publicKey: null },
      ]),
    );
  });
});

describe('departure key rotation gate', () => {
  test('removal and leave mark the circle rotation-pending; rotation clears it', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner, viewer: ownerViewer } = await signUp(t, 'owner@example.com');
    const { viewer: memberViewer } = await signUp(t, 'member@example.com');
    const { actor: leaver, viewer: leaverViewer } = await signUp(t, 'leaver@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await addMember(t, circle.circleId, leaverViewer._id);
    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });

    const membershipId = await t.run(async (ctx) => {
      const membership = await ctx.db
        .query('circleMembers')
        .withIndex('by_circle_and_user', (q) =>
          q.eq('circleId', circle.circleId).eq('userId', memberViewer._id),
        )
        .unique();

      return membership!._id;
    });

    await owner.mutation(api.circles.removeMember, {
      circleId: circle.circleId,
      memberId: membershipId,
    });

    await expect(
      owner.query(api.keys.getMyCircleKeys, { circleId: circle.circleId }),
    ).resolves.toMatchObject({ rotationPending: true, canRotate: true });

    await owner.mutation(api.keys.rotateCircleKey, {
      circleId: circle.circleId,
      grants: [{ userId: ownerViewer._id, sealedCircleKey: fakeSealedKey('owner_e2') }],
    });

    await expect(
      owner.query(api.keys.getMyCircleKeys, { circleId: circle.circleId }),
    ).resolves.toMatchObject({ currentEpoch: 2, rotationPending: false });

    await leaver.mutation(api.circles.leave, { circleId: circle.circleId });

    await expect(
      owner.query(api.keys.getMyCircleKeys, { circleId: circle.circleId }),
    ).resolves.toMatchObject({ rotationPending: true });
  });

  test('departures without any circle key do not set the gate', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { actor: leaver, viewer: leaverViewer } = await signUp(t, 'leaver@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, leaverViewer._id);
    await leaver.mutation(api.circles.leave, { circleId: circle.circleId });

    const circleDoc = await t.run(async (ctx) => await ctx.db.get(circle.circleId));

    expect(circleDoc?.keyRotationPendingAt).toBeUndefined();
  });
});

describe('grant cleanup', () => {
  test('removing a member and leaving both delete that member\'s grants', async () => {
    const t = convexTest(schema, modules);
    const { actor: owner } = await signUp(t, 'owner@example.com');
    const { actor: member, viewer: memberViewer } = await signUp(t, 'member@example.com');
    const { actor: leaver, viewer: leaverViewer } = await signUp(t, 'leaver@example.com');
    const circle = await owner.mutation(api.circles.create, { name: 'Familie' });

    await addMember(t, circle.circleId, memberViewer._id);
    await addMember(t, circle.circleId, leaverViewer._id);
    await owner.mutation(api.keys.initializeCircleKey, {
      circleId: circle.circleId,
      sealedCircleKey: fakeSealedKey('owner_e1'),
    });
    await owner.mutation(api.keys.grantCircleKeys, {
      circleId: circle.circleId,
      epoch: 1,
      grants: [
        { userId: memberViewer._id, sealedCircleKey: fakeSealedKey('member_e1') },
        { userId: leaverViewer._id, sealedCircleKey: fakeSealedKey('leaver_e1') },
      ],
    });

    const membershipId = await t.run(async (ctx) => {
      const membership = await ctx.db
        .query('circleMembers')
        .withIndex('by_circle_and_user', (q) =>
          q.eq('circleId', circle.circleId).eq('userId', memberViewer._id),
        )
        .unique();

      return membership!._id;
    });

    await owner.mutation(api.circles.removeMember, {
      circleId: circle.circleId,
      memberId: membershipId,
    });
    await leaver.mutation(api.circles.leave, { circleId: circle.circleId });

    const remainingGrantUserIds = await t.run(async (ctx) => {
      const grants = await ctx.db
        .query('circleKeyGrants')
        .withIndex('by_circle_and_epoch', (q) =>
          q.eq('circleId', circle.circleId).eq('epoch', 1),
        )
        .take(10);

      return grants.map((grant) => grant.userId);
    });

    expect(remainingGrantUserIds).toHaveLength(1);
    expect(remainingGrantUserIds[0]).not.toBe(memberViewer._id);
    expect(remainingGrantUserIds[0]).not.toBe(leaverViewer._id);

    // Removed members no longer see the circle's keys at all.
    await expect(
      member.query(api.keys.getMyCircleKeys, { circleId: circle.circleId }),
    ).rejects.toThrow(/membership required/i);
  });
});
