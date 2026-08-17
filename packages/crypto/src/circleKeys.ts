import { fromBase64, toBase64 } from './encoding';
import { SYMMETRIC_KEY_BYTES, type SodiumApi } from './sodium';
import { assertKeyLength, unwrapBytes, wrapBytes } from './wrap';

export function generateCircleKey(sodium: SodiumApi): Uint8Array {
  return sodium.randombytes_buf(SYMMETRIC_KEY_BYTES);
}

export function generateFileKey(sodium: SodiumApi): Uint8Array {
  return sodium.randombytes_buf(SYMMETRIC_KEY_BYTES);
}

/**
 * Seals a circle key to one member using their public key (anonymous sealed
 * box). Any member holding the circle key can produce grants; only the
 * recipient's private key can open them.
 */
export function sealCircleKeyForMember(
  sodium: SodiumApi,
  input: { circleKey: Uint8Array; memberPublicKey: Uint8Array },
): string {
  assertKeyLength(input.circleKey, 'circle key');

  return toBase64(sodium.crypto_box_seal(input.circleKey, input.memberPublicKey));
}

export function openCircleKeyGrant(
  sodium: SodiumApi,
  input: { sealedCircleKey: string; publicKey: Uint8Array; privateKey: Uint8Array },
): Uint8Array {
  const circleKey = sodium.crypto_box_seal_open(
    fromBase64(input.sealedCircleKey),
    input.publicKey,
    input.privateKey,
  );

  assertKeyLength(circleKey, 'circle key');

  return circleKey;
}

export function wrapFileKey(
  sodium: SodiumApi,
  input: { fileKey: Uint8Array; circleKey: Uint8Array },
): string {
  assertKeyLength(input.fileKey, 'file key');

  return wrapBytes(sodium, input.fileKey, input.circleKey);
}

export function unwrapFileKey(
  sodium: SodiumApi,
  input: { wrappedFileKey: string; circleKey: Uint8Array },
): Uint8Array {
  const fileKey = unwrapBytes(sodium, input.wrappedFileKey, input.circleKey);

  assertKeyLength(fileKey, 'file key');

  return fileKey;
}
