import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateUserKeyBundle,
  publicKeyFromBase64,
  recoverMasterKey,
  revealRecoveryKey,
  unlockPrivateKey,
  type SodiumApi,
  type UserKeyRegistration,
} from '@beisammen/crypto';

import type { UserKeyRecord } from './api';

export interface UnlockedUserKeys {
  masterKey: Uint8Array;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export type UserKeyBootstrapResult =
  /** Fresh account: keys were generated and registered; show the recovery code once. */
  | { status: 'generated'; keys: UnlockedUserKeys; recoveryCode: string }
  /** Existing keys unlocked with the locally stored master key. */
  | { status: 'unlocked'; keys: UnlockedUserKeys }
  /** Server has keys but this device holds no master key: ask for the recovery code. */
  | { status: 'recovery-required' };

interface BootstrapDeps {
  sodium: SodiumApi;
  serverKeys: UserKeyRecord | null;
  storedMasterKey: Uint8Array | null;
  registerKeys: (registration: UserKeyRegistration) => Promise<{ created: boolean }>;
  saveMasterKey: (masterKey: Uint8Array) => Promise<void>;
}

function unlock(sodium: SodiumApi, serverKeys: UserKeyRecord, masterKey: Uint8Array): UnlockedUserKeys {
  return {
    masterKey,
    publicKey: publicKeyFromBase64(serverKeys.publicKey),
    privateKey: unlockPrivateKey(sodium, {
      encPrivateKey: serverKeys.encPrivateKey,
      masterKey,
    }),
  };
}

export async function bootstrapUserKeys(deps: BootstrapDeps): Promise<UserKeyBootstrapResult> {
  const { sodium, serverKeys, storedMasterKey } = deps;

  if (serverKeys) {
    if (!storedMasterKey) {
      return { status: 'recovery-required' };
    }

    try {
      return { status: 'unlocked', keys: unlock(sodium, serverKeys, storedMasterKey) };
    } catch {
      // A stale keychain entry (e.g. from a deleted-and-recreated account)
      // cannot unlock the registered keys; fall back to recovery.
      return { status: 'recovery-required' };
    }
  }

  const bundle = generateUserKeyBundle(sodium);

  try {
    await deps.registerKeys(bundle.registration);
  } catch (error) {
    // Another device won the registration race; this device needs the
    // recovery code (or iCloud Keychain) to obtain the master key.
    if (error instanceof Error && /already registered/i.test(error.message)) {
      return { status: 'recovery-required' };
    }

    throw error;
  }

  await deps.saveMasterKey(bundle.masterKey);

  return {
    status: 'generated',
    keys: {
      masterKey: bundle.masterKey,
      publicKey: bundle.publicKey,
      privateKey: bundle.privateKey,
    },
    recoveryCode: encodeRecoveryCode(sodium, bundle.recoveryKey),
  };
}

/**
 * Last-resort reset when the recovery code is lost: generates a fresh key
 * hierarchy, replaces the server registration, and stores the new master key
 * locally. Old grants become unreadable and are deleted server-side; circle
 * access is restored by other members' automatic grant top-up. Returns the
 * new recovery code, which must be shown to the user exactly once.
 */
export async function resetUserKeys(deps: {
  sodium: SodiumApi;
  resetKeys: (registration: UserKeyRegistration) => Promise<{ created: boolean }>;
  saveMasterKey: (masterKey: Uint8Array) => Promise<void>;
}): Promise<{
  keys: UnlockedUserKeys;
  recoveryCode: string;
  registration: UserKeyRegistration;
}> {
  const bundle = generateUserKeyBundle(deps.sodium);

  await deps.resetKeys(bundle.registration);
  await deps.saveMasterKey(bundle.masterKey);

  return {
    keys: {
      masterKey: bundle.masterKey,
      publicKey: bundle.publicKey,
      privateKey: bundle.privateKey,
    },
    recoveryCode: encodeRecoveryCode(deps.sodium, bundle.recoveryKey),
    registration: bundle.registration,
  };
}

/** Redeems a typed recovery code on a new device and stores the master key locally. */
export async function recoverUserKeys(deps: {
  sodium: SodiumApi;
  serverKeys: UserKeyRecord;
  recoveryCode: string;
  saveMasterKey: (masterKey: Uint8Array) => Promise<void>;
}): Promise<UnlockedUserKeys> {
  const recoveryKey = decodeRecoveryCode(deps.sodium, deps.recoveryCode);
  const masterKey = recoverMasterKey(deps.sodium, {
    encMasterKeyByRecovery: deps.serverKeys.encMasterKeyByRecovery,
    recoveryKey,
  });
  const keys = unlock(deps.sodium, deps.serverKeys, masterKey);

  await deps.saveMasterKey(masterKey);

  return keys;
}

/** Re-displays the recovery code on an unlocked device (settings screen). */
export function revealRecoveryCode(
  sodium: SodiumApi,
  serverKeys: UserKeyRecord,
  masterKey: Uint8Array,
): string {
  return encodeRecoveryCode(
    sodium,
    revealRecoveryKey(sodium, {
      encRecoveryKeyByMaster: serverKeys.encRecoveryKeyByMaster,
      masterKey,
    }),
  );
}
