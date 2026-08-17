import { fromBase64, toBase64 } from './encoding';
import { SYMMETRIC_KEY_BYTES, type SodiumApi } from './sodium';
import { unwrapBytes, wrapBytes } from './wrap';

export const USER_KEY_VERSION = 1;

/** Server-storable part of a user's key material; contains no plaintext secrets. */
export interface UserKeyRegistration {
  keyVersion: number;
  publicKey: string;
  encPrivateKey: string;
  encMasterKeyByRecovery: string;
  encRecoveryKeyByMaster: string;
}

export interface UserKeyBundle {
  masterKey: Uint8Array;
  recoveryKey: Uint8Array;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  registration: UserKeyRegistration;
}

/**
 * Generates a user's full key hierarchy on-device: master key (kept in the
 * device keychain), recovery key (shown once to the user), and an X25519
 * keypair for receiving sealed circle-key grants. Only `registration` may be
 * sent to the server.
 */
export function generateUserKeyBundle(sodium: SodiumApi): UserKeyBundle {
  const masterKey = sodium.randombytes_buf(SYMMETRIC_KEY_BYTES);
  const recoveryKey = sodium.randombytes_buf(SYMMETRIC_KEY_BYTES);
  const keypair = sodium.crypto_box_keypair();

  return {
    masterKey,
    recoveryKey,
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    registration: {
      keyVersion: USER_KEY_VERSION,
      publicKey: toBase64(keypair.publicKey),
      encPrivateKey: wrapBytes(sodium, keypair.privateKey, masterKey),
      encMasterKeyByRecovery: wrapBytes(sodium, masterKey, recoveryKey),
      encRecoveryKeyByMaster: wrapBytes(sodium, recoveryKey, masterKey),
    },
  };
}

export function unlockPrivateKey(
  sodium: SodiumApi,
  input: { encPrivateKey: string; masterKey: Uint8Array },
): Uint8Array {
  return unwrapBytes(sodium, input.encPrivateKey, input.masterKey);
}

/** New-device recovery: the recovery code yields the master key from the server-stored wrap. */
export function recoverMasterKey(
  sodium: SodiumApi,
  input: { encMasterKeyByRecovery: string; recoveryKey: Uint8Array },
): Uint8Array {
  return unwrapBytes(sodium, input.encMasterKeyByRecovery, input.recoveryKey);
}

/** Lets a signed-in device re-display the recovery code from the master key. */
export function revealRecoveryKey(
  sodium: SodiumApi,
  input: { encRecoveryKeyByMaster: string; masterKey: Uint8Array },
): Uint8Array {
  return unwrapBytes(sodium, input.encRecoveryKeyByMaster, input.masterKey);
}

export function publicKeyFromBase64(publicKey: string): Uint8Array {
  const bytes = fromBase64(publicKey);

  if (bytes.length !== SYMMETRIC_KEY_BYTES) {
    throw new Error('Invalid public key length.');
  }

  return bytes;
}
