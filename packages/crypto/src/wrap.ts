import { concatBytes, fromBase64, toBase64 } from './encoding';
import { SECRETBOX_NONCE_BYTES, SYMMETRIC_KEY_BYTES, type SodiumApi } from './sodium';

/**
 * Symmetric wrapping used throughout the key hierarchy:
 * base64(nonce || crypto_secretbox(plaintext, nonce, wrappingKey)).
 */
export function wrapBytes(sodium: SodiumApi, plaintext: Uint8Array, wrappingKey: Uint8Array): string {
  assertKeyLength(wrappingKey, 'wrapping key');

  const nonce = sodium.randombytes_buf(SECRETBOX_NONCE_BYTES);
  const box = sodium.crypto_secretbox_easy(plaintext, nonce, wrappingKey);

  return toBase64(concatBytes(nonce, box));
}

export function unwrapBytes(sodium: SodiumApi, wrapped: string, wrappingKey: Uint8Array): Uint8Array {
  assertKeyLength(wrappingKey, 'wrapping key');

  const bytes = fromBase64(wrapped);

  if (bytes.length <= SECRETBOX_NONCE_BYTES) {
    throw new Error('Wrapped value is too short.');
  }

  return sodium.crypto_secretbox_open_easy(
    bytes.subarray(SECRETBOX_NONCE_BYTES),
    bytes.subarray(0, SECRETBOX_NONCE_BYTES),
    wrappingKey,
  );
}

export function assertKeyLength(key: Uint8Array, label: string): void {
  if (key.length !== SYMMETRIC_KEY_BYTES) {
    throw new Error(`Invalid ${label} length: expected ${SYMMETRIC_KEY_BYTES} bytes.`);
  }
}
