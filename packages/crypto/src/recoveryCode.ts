import { concatBytes } from './encoding';
import { SYMMETRIC_KEY_BYTES, type SodiumApi } from './sodium';

// Crockford base32: no I, L, O, U; decoding tolerates lowercase and maps
// visually ambiguous characters back (0/O, 1/I/L).
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CHECKSUM_BYTES = 2;
const RECOVERY_GROUP_LENGTH = 5;

function checksumFor(sodium: SodiumApi, key: Uint8Array): Uint8Array {
  return sodium.crypto_generichash(SYMMETRIC_KEY_BYTES, key).subarray(0, RECOVERY_CHECKSUM_BYTES);
}

function encodeCrockford(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;

    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      output += CROCKFORD_ALPHABET[(buffer >> bitsInBuffer) & 0x1f];
    }
  }

  if (bitsInBuffer > 0) {
    output += CROCKFORD_ALPHABET[(buffer << (5 - bitsInBuffer)) & 0x1f];
  }

  return output;
}

function decodeCrockford(value: string, expectedBytes: number): Uint8Array {
  const output = new Uint8Array(expectedBytes);
  let outputIndex = 0;
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const rawChar of value) {
    const char = rawChar.toUpperCase().replace('O', '0').replace(/[IL]/, '1');
    const index = CROCKFORD_ALPHABET.indexOf(char);

    if (index < 0) {
      throw new Error('Recovery code contains an invalid character.');
    }

    buffer = (buffer << 5) | index;
    bitsInBuffer += 5;

    if (bitsInBuffer >= 8 && outputIndex < expectedBytes) {
      bitsInBuffer -= 8;
      output[outputIndex] = (buffer >> bitsInBuffer) & 0xff;
      outputIndex += 1;
    }
  }

  if (outputIndex !== expectedBytes) {
    throw new Error('Recovery code has the wrong length.');
  }

  return output;
}

/** Formats a recovery key as `XXXXX-XXXXX-…` (Crockford base32 with a checksum). */
export function encodeRecoveryCode(sodium: SodiumApi, recoveryKey: Uint8Array): string {
  if (recoveryKey.length !== SYMMETRIC_KEY_BYTES) {
    throw new Error('Invalid recovery key length.');
  }

  const encoded = encodeCrockford(concatBytes(recoveryKey, checksumFor(sodium, recoveryKey)));
  const groups: string[] = [];

  for (let index = 0; index < encoded.length; index += RECOVERY_GROUP_LENGTH) {
    groups.push(encoded.slice(index, index + RECOVERY_GROUP_LENGTH));
  }

  return groups.join('-');
}

export function decodeRecoveryCode(sodium: SodiumApi, code: string): Uint8Array {
  const compact = code.replace(/[\s-]/g, '');
  const decoded = decodeCrockford(compact, SYMMETRIC_KEY_BYTES + RECOVERY_CHECKSUM_BYTES);
  const recoveryKey = decoded.subarray(0, SYMMETRIC_KEY_BYTES);
  const checksum = decoded.subarray(SYMMETRIC_KEY_BYTES);
  const expected = checksumFor(sodium, recoveryKey);

  if (checksum[0] !== expected[0] || checksum[1] !== expected[1]) {
    throw new Error('Recovery code checksum does not match. Please re-check the code.');
  }

  return recoveryKey;
}
