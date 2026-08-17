import _sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  encodeRecoveryCode,
  generateUserKeyBundle,
  type SodiumApi,
  type UserKeyBundle,
} from '@beisammen/crypto';

import type { UserKeyRecord } from './api';
import { bootstrapUserKeys, recoverUserKeys, revealRecoveryCode } from './user-keys';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

function recordFromBundle(bundle: UserKeyBundle): UserKeyRecord {
  return {
    ...bundle.registration,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('bootstrapUserKeys', () => {
  test('fresh account: generates, registers, saves the master key, and returns the recovery code', async () => {
    const registerKeys = vi.fn().mockResolvedValue({ created: true });
    const saveMasterKey = vi.fn().mockResolvedValue(undefined);

    const result = await bootstrapUserKeys({
      sodium,
      serverKeys: null,
      storedMasterKey: null,
      registerKeys,
      saveMasterKey,
    });

    expect(result.status).toBe('generated');

    if (result.status !== 'generated') {
      throw new Error('unreachable');
    }

    expect(registerKeys).toHaveBeenCalledOnce();
    expect(saveMasterKey).toHaveBeenCalledWith(result.keys.masterKey);
    expect(result.recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{1,5})+$/);

    // The registration sent to the server unlocks with the returned keys.
    const registration = registerKeys.mock.calls[0]![0];
    const record: UserKeyRecord = { ...registration, createdAt: 1, updatedAt: 1 };
    const unlocked = await bootstrapUserKeys({
      sodium,
      serverKeys: record,
      storedMasterKey: result.keys.masterKey,
      registerKeys: vi.fn(),
      saveMasterKey: vi.fn(),
    });

    expect(unlocked.status).toBe('unlocked');
  });

  test('unlock path: existing server keys plus stored master key', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const registerKeys = vi.fn();

    const result = await bootstrapUserKeys({
      sodium,
      serverKeys: recordFromBundle(bundle),
      storedMasterKey: bundle.masterKey,
      registerKeys,
      saveMasterKey: vi.fn(),
    });

    expect(result.status).toBe('unlocked');

    if (result.status !== 'unlocked') {
      throw new Error('unreachable');
    }

    expect(result.keys.publicKey).toEqual(bundle.publicKey);
    expect(result.keys.privateKey).toEqual(bundle.privateKey);
    expect(registerKeys).not.toHaveBeenCalled();
  });

  test('recovery-required: server keys exist but no local master key', async () => {
    const bundle = generateUserKeyBundle(sodium);

    const result = await bootstrapUserKeys({
      sodium,
      serverKeys: recordFromBundle(bundle),
      storedMasterKey: null,
      registerKeys: vi.fn(),
      saveMasterKey: vi.fn(),
    });

    expect(result).toEqual({ status: 'recovery-required' });
  });

  test('stale master key falls back to recovery instead of throwing', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const staleKey = sodium.randombytes_buf(32);

    const result = await bootstrapUserKeys({
      sodium,
      serverKeys: recordFromBundle(bundle),
      storedMasterKey: staleKey,
      registerKeys: vi.fn(),
      saveMasterKey: vi.fn(),
    });

    expect(result).toEqual({ status: 'recovery-required' });
  });

  test('registration race: "already registered" error maps to recovery-required', async () => {
    const saveMasterKey = vi.fn();

    const result = await bootstrapUserKeys({
      sodium,
      serverKeys: null,
      storedMasterKey: null,
      registerKeys: vi
        .fn()
        .mockRejectedValue(
          new Error('Keys are already registered for this account. Use the recovery code.'),
        ),
      saveMasterKey,
    });

    expect(result).toEqual({ status: 'recovery-required' });
    expect(saveMasterKey).not.toHaveBeenCalled();
  });

  test('other registration errors are rethrown', async () => {
    await expect(
      bootstrapUserKeys({
        sodium,
        serverKeys: null,
        storedMasterKey: null,
        registerKeys: vi.fn().mockRejectedValue(new Error('Network request failed')),
        saveMasterKey: vi.fn(),
      }),
    ).rejects.toThrow('Network request failed');
  });
});

describe('recoverUserKeys', () => {
  test('happy path: recovery code unlocks the keys and stores the master key', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const code = encodeRecoveryCode(sodium, bundle.recoveryKey);
    const saveMasterKey = vi.fn().mockResolvedValue(undefined);

    const keys = await recoverUserKeys({
      sodium,
      serverKeys: recordFromBundle(bundle),
      // Tolerates lowercase and missing dashes.
      recoveryCode: code.toLowerCase().replaceAll('-', ' '),
      saveMasterKey,
    });

    expect(keys.masterKey).toEqual(bundle.masterKey);
    expect(keys.privateKey).toEqual(bundle.privateKey);
    expect(saveMasterKey).toHaveBeenCalledWith(bundle.masterKey);
  });

  test('wrong code fails the checksum and stores nothing', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const otherCode = encodeRecoveryCode(sodium, sodium.randombytes_buf(32));
    // Corrupt a character so the checksum no longer matches.
    const wrongCode = otherCode.startsWith('A') ? `B${otherCode.slice(1)}` : `A${otherCode.slice(1)}`;
    const saveMasterKey = vi.fn();

    await expect(
      recoverUserKeys({
        sodium,
        serverKeys: recordFromBundle(bundle),
        recoveryCode: wrongCode,
        saveMasterKey,
      }),
    ).rejects.toThrow();
    expect(saveMasterKey).not.toHaveBeenCalled();
  });

  test('a valid code for different keys fails to unwrap the master key', async () => {
    const bundle = generateUserKeyBundle(sodium);
    const otherBundle = generateUserKeyBundle(sodium);
    const saveMasterKey = vi.fn();

    await expect(
      recoverUserKeys({
        sodium,
        serverKeys: recordFromBundle(bundle),
        recoveryCode: encodeRecoveryCode(sodium, otherBundle.recoveryKey),
        saveMasterKey,
      }),
    ).rejects.toThrow();
    expect(saveMasterKey).not.toHaveBeenCalled();
  });
});

describe('revealRecoveryCode', () => {
  test('re-derives the exact recovery code from the unlocked master key', () => {
    const bundle = generateUserKeyBundle(sodium);
    const expected = encodeRecoveryCode(sodium, bundle.recoveryKey);

    expect(revealRecoveryCode(sodium, recordFromBundle(bundle), bundle.masterKey)).toBe(expected);
  });
});
