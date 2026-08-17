/**
 * Minimal libsodium surface used by this package. Both `libsodium-wrappers`
 * (web, tests) and `react-native-libsodium` (mobile) satisfy this interface;
 * callers await `ready` once and then pass the module in.
 */
export interface SodiumApi {
  ready: Promise<void>;
  randombytes_buf(length: number): Uint8Array;
  crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_secretbox_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array; keyType: string };
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  crypto_box_seal_open(
    ciphertext: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  // additionalData is typed as string (not Uint8Array) on purpose:
  // react-native-libsodium only implements the string input path for AEAD
  // additional data and throws on binary input. Strings are converted to
  // UTF-8 identically by both implementations, so callers pass base64.
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: string,
    secretNonce: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    secretNonce: Uint8Array | null,
    ciphertext: Uint8Array,
    additionalData: string,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  crypto_generichash(hashLength: number, message: Uint8Array): Uint8Array;
}

export const SYMMETRIC_KEY_BYTES = 32;
export const SECRETBOX_NONCE_BYTES = 24;
export const XCHACHA_NONCE_BYTES = 24;
export const XCHACHA_TAG_BYTES = 16;
