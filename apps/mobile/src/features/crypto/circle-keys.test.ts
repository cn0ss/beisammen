import _sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  generateCircleKey,
  generateUserKeyBundle,
  openCircleKeyGrant,
  sealCircleKeyForMember,
  toBase64,
  type SodiumApi,
  type UserKeyBundle,
} from '@beisammen/crypto';

import {
  buildMissingGrantPayload,
  buildMissingGrantPayloadsByEpoch,
  buildRotationPayload,
  ensureCircleKey,
} from './circle-keys';
import type { UnlockedUserKeys } from './user-keys';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

function unlockedKeys(bundle: UserKeyBundle): UnlockedUserKeys {
  return {
    masterKey: bundle.masterKey,
    publicKey: bundle.publicKey,
    privateKey: bundle.privateKey,
  };
}

function grantFor(circleKey: Uint8Array, bundle: UserKeyBundle, epoch: number) {
  return {
    epoch,
    sealedCircleKey: sealCircleKeyForMember(sodium, {
      circleKey,
      memberPublicKey: bundle.publicKey,
    }),
    grantedBy: 'granter',
    createdAt: 1,
  };
}

describe('ensureCircleKey', () => {
  test('initializes epoch 1 with a self-grant when the circle has no key', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const initializeCircleKey = vi.fn().mockResolvedValue({ epoch: 1, created: true });

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      getMyCircleKeys: vi.fn().mockResolvedValue({ currentEpoch: null, grants: [] }),
      initializeCircleKey,
    });

    expect(result.status).toBe('ready');

    if (result.status !== 'ready') {
      throw new Error('unreachable');
    }

    expect(result.epoch).toBe(1);
    expect(result.keysByEpoch.get(1)).toEqual(result.circleKey);

    // The sealed self-grant sent to the server opens back to the same key.
    const sealed = initializeCircleKey.mock.calls[0]![0] as string;
    const opened = openCircleKeyGrant(sodium, {
      sealedCircleKey: sealed,
      publicKey: bundle.publicKey,
      privateKey: bundle.privateKey,
    });

    expect(opened).toEqual(result.circleKey);
  });

  test('losing the initialization race re-reads and uses the stored grant', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const winnerKey = generateCircleKey(sodium);
    const getMyCircleKeys = vi
      .fn()
      .mockResolvedValueOnce({ currentEpoch: null, grants: [] })
      .mockResolvedValueOnce({ currentEpoch: 1, grants: [grantFor(winnerKey, bundle, 1)] });

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      getMyCircleKeys,
      initializeCircleKey: vi.fn().mockResolvedValue({ epoch: 1, created: false }),
    });

    expect(getMyCircleKeys).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ready');

    if (result.status !== 'ready') {
      throw new Error('unreachable');
    }

    expect(result.circleKey).toEqual(winnerKey);
  });

  test('waiting-for-grant when the current epoch has no readable grant', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const oldKey = generateCircleKey(sodium);

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      // Grant only for epoch 1 while the circle is already on epoch 2.
      getMyCircleKeys: vi
        .fn()
        .mockResolvedValue({ currentEpoch: 2, grants: [grantFor(oldKey, bundle, 1)] }),
      initializeCircleKey: vi.fn(),
    });

    expect(result).toEqual({ status: 'waiting-for-grant', currentEpoch: 2 });
  });

  test('grant resolution opens all epochs and returns the current key', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const keyEpoch1 = generateCircleKey(sodium);
    const keyEpoch2 = generateCircleKey(sodium);

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      getMyCircleKeys: vi.fn().mockResolvedValue({
        currentEpoch: 2,
        grants: [grantFor(keyEpoch1, bundle, 1), grantFor(keyEpoch2, bundle, 2)],
      }),
      initializeCircleKey: vi.fn(),
    });

    expect(result.status).toBe('ready');

    if (result.status !== 'ready') {
      throw new Error('unreachable');
    }

    expect(result.epoch).toBe(2);
    expect(result.circleKey).toEqual(keyEpoch2);
    expect(result.keysByEpoch.get(1)).toEqual(keyEpoch1);
    expect(result.keysByEpoch.get(2)).toEqual(keyEpoch2);
  });

  test('a grant sealed to foreign keys is skipped instead of failing', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const otherBundle = generateUserKeyBundle(sodium);
    const circleKey = generateCircleKey(sodium);

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      getMyCircleKeys: vi
        .fn()
        .mockResolvedValue({ currentEpoch: 1, grants: [grantFor(circleKey, otherBundle, 1)] }),
      initializeCircleKey: vi.fn(),
    });

    expect(result).toEqual({ status: 'waiting-for-grant', currentEpoch: 1 });
  });

  test('an unreadable current-epoch grant is rejected so it can be replaced', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const otherBundle = generateUserKeyBundle(sodium);
    const oldKey = generateCircleKey(sodium);
    const poisonedKey = generateCircleKey(sodium);
    const rejectKeyGrant = vi.fn().mockResolvedValue({ rejected: true });

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      getMyCircleKeys: vi.fn().mockResolvedValue({
        currentEpoch: 2,
        grants: [
          // Readable old epoch stays untouched; only the unreadable current
          // grant (sealed to someone else's keys) is rejected server-side.
          grantFor(oldKey, bundle, 1),
          grantFor(poisonedKey, otherBundle, 2),
        ],
      }),
      initializeCircleKey: vi.fn(),
      rejectKeyGrant,
    });

    expect(result).toEqual({ status: 'waiting-for-grant', currentEpoch: 2 });
    expect(rejectKeyGrant).toHaveBeenCalledTimes(1);
    expect(rejectKeyGrant).toHaveBeenCalledWith(2);
  });

  test('a missing (not unreadable) current-epoch grant is not rejected', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const oldKey = generateCircleKey(sodium);
    const rejectKeyGrant = vi.fn();

    const result = await ensureCircleKey({
      sodium,
      userKeys: unlockedKeys(bundle),
      getMyCircleKeys: vi
        .fn()
        .mockResolvedValue({ currentEpoch: 2, grants: [grantFor(oldKey, bundle, 1)] }),
      initializeCircleKey: vi.fn(),
      rejectKeyGrant,
    });

    expect(result).toEqual({ status: 'waiting-for-grant', currentEpoch: 2 });
    expect(rejectKeyGrant).not.toHaveBeenCalled();
  });
});

describe('buildMissingGrantPayload', () => {
  test('seals the key to members with keys and skips members without', () => {
    const circleKey = generateCircleKey(sodium);
    const memberBundle = generateUserKeyBundle(sodium);

    const payload = buildMissingGrantPayload(sodium, circleKey, [
      { userId: 'with-keys', publicKey: toBase64(memberBundle.publicKey) },
      { userId: 'without-keys', publicKey: null },
    ]);

    expect(payload).toHaveLength(1);
    expect(payload[0]!.userId).toBe('with-keys');

    const opened = openCircleKeyGrant(sodium, {
      sealedCircleKey: payload[0]!.sealedCircleKey,
      publicKey: memberBundle.publicKey,
      privateKey: memberBundle.privateKey,
    });

    expect(opened).toEqual(circleKey);
  });

  test('a malformed public key skips that member without aborting the batch', () => {
    const circleKey = generateCircleKey(sodium);
    const memberBundle = generateUserKeyBundle(sodium);

    const payload = buildMissingGrantPayload(sodium, circleKey, [
      { userId: 'poisoned', publicKey: 'not-a-valid-key' },
      { userId: 'with-keys', publicKey: toBase64(memberBundle.publicKey) },
    ]);

    expect(payload.map((entry) => entry.userId)).toEqual(['with-keys']);
  });
});

describe('buildMissingGrantPayloadsByEpoch', () => {
  test('seals each held epoch to its missing members and skips unheld epochs', () => {
    const keyEpoch1 = generateCircleKey(sodium);
    const keyEpoch2 = generateCircleKey(sodium);
    const joiner = generateUserKeyBundle(sodium);

    const payloads = buildMissingGrantPayloadsByEpoch(
      sodium,
      new Map([
        [1, keyEpoch1],
        [2, keyEpoch2],
      ]),
      [
        { epoch: 3, members: [{ userId: 'joiner', publicKey: toBase64(joiner.publicKey) }] },
        { epoch: 2, members: [{ userId: 'joiner', publicKey: toBase64(joiner.publicKey) }] },
        { epoch: 1, members: [{ userId: 'joiner', publicKey: toBase64(joiner.publicKey) }] },
      ],
    );

    // Epoch 3 is not held and gets no payload; 1 and 2 are both covered.
    expect(payloads.map((payload) => payload.epoch)).toEqual([2, 1]);

    for (const [epoch, circleKey] of [
      [2, keyEpoch2],
      [1, keyEpoch1],
    ] as const) {
      const grant = payloads.find((payload) => payload.epoch === epoch)!.grants[0]!;
      const opened = openCircleKeyGrant(sodium, {
        sealedCircleKey: grant.sealedCircleKey,
        publicKey: joiner.publicKey,
        privateKey: joiner.privateKey,
      });

      expect(opened).toEqual(circleKey);
    }
  });

  test('members without keys produce no payload entry for that epoch', () => {
    const payloads = buildMissingGrantPayloadsByEpoch(
      sodium,
      new Map([[1, generateCircleKey(sodium)]]),
      [{ epoch: 1, members: [{ userId: 'keyless', publicKey: null }] }],
    );

    expect(payloads).toEqual([]);
  });
});

describe('buildRotationPayload', () => {
  test('generates a fresh key sealed to every member with keys, reporting the skipped', () => {
    const self = generateUserKeyBundle(sodium);
    const other = generateUserKeyBundle(sodium);

    const rotation = buildRotationPayload(sodium, [
      { userId: 'self', publicKey: toBase64(self.publicKey) },
      { userId: 'other', publicKey: toBase64(other.publicKey) },
      { userId: 'no-keys', publicKey: null },
    ]);

    expect(rotation.grants.map((grant) => grant.userId)).toEqual(['self', 'other']);
    expect(rotation.skippedUserIds).toEqual(['no-keys']);

    for (const [bundle, userId] of [
      [self, 'self'],
      [other, 'other'],
    ] as const) {
      const grant = rotation.grants.find((entry) => entry.userId === userId)!;
      const opened = openCircleKeyGrant(sodium, {
        sealedCircleKey: grant.sealedCircleKey,
        publicKey: bundle.publicKey,
        privateKey: bundle.privateKey,
      });

      expect(opened).toEqual(rotation.circleKey);
    }
  });

  test('a malformed public key is skipped so rotation still reaches everyone else', () => {
    const self = generateUserKeyBundle(sodium);

    const rotation = buildRotationPayload(sodium, [
      { userId: 'self', publicKey: toBase64(self.publicKey) },
      { userId: 'poisoned', publicKey: 'definitely!not@base64' },
    ]);

    expect(rotation.grants.map((grant) => grant.userId)).toEqual(['self']);
    expect(rotation.skippedUserIds).toEqual(['poisoned']);
  });
});
