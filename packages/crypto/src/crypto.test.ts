import _sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  chunkCount,
  ciphertextLength,
  ciphertextRangeForChunk,
  createFileHeader,
  decodeRecoveryCode,
  decryptBytes,
  decryptChunk,
  encodeRecoveryCode,
  encryptBytes,
  encryptChunk,
  generateCircleKey,
  generateFileKey,
  generateUserKeyBundle,
  openCircleKeyGrant,
  parseFileHeader,
  publicKeyFromBase64,
  recoverMasterKey,
  revealRecoveryKey,
  sealCircleKeyForMember,
  unlockPrivateKey,
  unwrapFileKey,
  wrapFileKey,
  type SodiumApi,
} from './index';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

describe('user key hierarchy', () => {
  test('registration round-trips private key, master key, and recovery key', () => {
    const bundle = generateUserKeyBundle(sodium);

    expect(publicKeyFromBase64(bundle.registration.publicKey)).toEqual(bundle.publicKey);
    expect(
      unlockPrivateKey(sodium, {
        encPrivateKey: bundle.registration.encPrivateKey,
        masterKey: bundle.masterKey,
      }),
    ).toEqual(bundle.privateKey);
    expect(
      recoverMasterKey(sodium, {
        encMasterKeyByRecovery: bundle.registration.encMasterKeyByRecovery,
        recoveryKey: bundle.recoveryKey,
      }),
    ).toEqual(bundle.masterKey);
    expect(
      revealRecoveryKey(sodium, {
        encRecoveryKeyByMaster: bundle.registration.encRecoveryKeyByMaster,
        masterKey: bundle.masterKey,
      }),
    ).toEqual(bundle.recoveryKey);
  });

  test('a wrong master key cannot unlock the private key', () => {
    const bundle = generateUserKeyBundle(sodium);
    const wrongKey = sodium.randombytes_buf(32);

    expect(() =>
      unlockPrivateKey(sodium, {
        encPrivateKey: bundle.registration.encPrivateKey,
        masterKey: wrongKey,
      }),
    ).toThrow();
  });
});

describe('recovery code', () => {
  test('round-trips and tolerates formatting and ambiguous characters', () => {
    const bundle = generateUserKeyBundle(sodium);
    const code = encodeRecoveryCode(sodium, bundle.recoveryKey);

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{1,5})+$/);
    expect(decodeRecoveryCode(sodium, code)).toEqual(bundle.recoveryKey);
    expect(decodeRecoveryCode(sodium, code.toLowerCase().replaceAll('-', ' '))).toEqual(
      bundle.recoveryKey,
    );
    expect(decodeRecoveryCode(sodium, code.replaceAll('0', 'O'))).toEqual(bundle.recoveryKey);
  });

  test('rejects a mistyped code via checksum', () => {
    const bundle = generateUserKeyBundle(sodium);
    const code = encodeRecoveryCode(sodium, bundle.recoveryKey);
    const corrupted = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);

    expect(() => decodeRecoveryCode(sodium, corrupted)).toThrow(/checksum|invalid/i);
  });
});

describe('circle and file keys', () => {
  test('sealed circle-key grants open only with the right keypair', () => {
    const alice = generateUserKeyBundle(sodium);
    const mallory = generateUserKeyBundle(sodium);
    const circleKey = generateCircleKey(sodium);
    const sealed = sealCircleKeyForMember(sodium, {
      circleKey,
      memberPublicKey: alice.publicKey,
    });

    expect(
      openCircleKeyGrant(sodium, {
        sealedCircleKey: sealed,
        publicKey: alice.publicKey,
        privateKey: alice.privateKey,
      }),
    ).toEqual(circleKey);
    expect(() =>
      openCircleKeyGrant(sodium, {
        sealedCircleKey: sealed,
        publicKey: mallory.publicKey,
        privateKey: mallory.privateKey,
      }),
    ).toThrow();
  });

  test('file keys wrap and unwrap with the circle key', () => {
    const circleKey = generateCircleKey(sodium);
    const fileKey = generateFileKey(sodium);
    const wrapped = wrapFileKey(sodium, { fileKey, circleKey });

    expect(unwrapFileKey(sodium, { wrappedFileKey: wrapped, circleKey })).toEqual(fileKey);
    expect(() =>
      unwrapFileKey(sodium, { wrappedFileKey: wrapped, circleKey: generateCircleKey(sodium) }),
    ).toThrow();
  });
});

describe('chunked file encryption', () => {
  function randomPlaintext(length: number): Uint8Array {
    return length === 0 ? new Uint8Array(0) : sodium.randombytes_buf(length);
  }

  test.each([0, 1, 20, 64, 65, 200])('round-trips %s bytes with a 64-byte chunk size', (length) => {
    const fileKey = generateFileKey(sodium);
    const plaintext = randomPlaintext(length);
    const ciphertext = encryptBytes(sodium, { fileKey, plaintext, chunkSize: 64 });

    expect(ciphertext.length).toBe(ciphertextLength(parseFileHeader(ciphertext)));
    expect(decryptBytes(sodium, { fileKey, ciphertext })).toEqual(plaintext);
  });

  test('chunks decrypt independently via their ciphertext range (random access)', () => {
    const fileKey = generateFileKey(sodium);
    const plaintext = randomPlaintext(300);
    const ciphertext = encryptBytes(sodium, { fileKey, plaintext, chunkSize: 100 });
    const header = parseFileHeader(ciphertext);

    expect(chunkCount(header)).toBe(3);

    const range = ciphertextRangeForChunk(header, 1);
    const middle = decryptChunk(sodium, {
      fileKey,
      header,
      chunkIndex: 1,
      ciphertext: ciphertext.subarray(range.start, range.end),
    });

    expect(middle).toEqual(plaintext.subarray(100, 200));
  });

  test('detects tampering, chunk reordering, and truncation', () => {
    const fileKey = generateFileKey(sodium);
    const plaintext = randomPlaintext(200);
    const ciphertext = encryptBytes(sodium, { fileKey, plaintext, chunkSize: 100 });
    const header = parseFileHeader(ciphertext);

    const tampered = ciphertext.slice();
    tampered[80] ^= 0x01;
    expect(() => decryptBytes(sodium, { fileKey, ciphertext: tampered })).toThrow();

    const firstRange = ciphertextRangeForChunk(header, 0);
    const secondRange = ciphertextRangeForChunk(header, 1);
    expect(() =>
      decryptChunk(sodium, {
        fileKey,
        header,
        chunkIndex: 0,
        ciphertext: ciphertext.subarray(secondRange.start, secondRange.end),
      }),
    ).toThrow();
    expect(() =>
      decryptBytes(sodium, {
        fileKey,
        ciphertext: ciphertext.subarray(0, firstRange.end),
      }),
    ).toThrow();
  });

  test('rejects attacker-sized chunkSize fields before any allocation', () => {
    const fileKey = generateFileKey(sodium);
    const ciphertext = encryptBytes(sodium, { fileKey, plaintext: randomPlaintext(64) });

    // The chunkSize field is read before any chunk is authenticated, so a
    // crafted header must not be able to drive multi-gigabyte range requests
    // or buffers (values from the security review's proof-of-concept).
    for (const chunkSize of [64 * 1024 * 1024, 1024 ** 3, 0xffffffff]) {
      const crafted = ciphertext.slice();

      new DataView(crafted.buffer).setUint32(8, chunkSize, true);
      expect(() => parseFileHeader(crafted)).toThrow(/invalid chunk size/i);
    }

    expect(() =>
      createFileHeader(sodium, { plaintextLength: 10, chunkSize: 64 * 1024 * 1024 }),
    ).toThrow(/invalid chunk size/i);
  });

  test('encryptChunk validates plaintext lengths against the header', () => {
    const fileKey = generateFileKey(sodium);
    const header = createFileHeader(sodium, { plaintextLength: 150, chunkSize: 100 });

    expect(() =>
      encryptChunk(sodium, {
        fileKey,
        header,
        chunkIndex: 0,
        plaintext: randomPlaintext(99),
      }),
    ).toThrow(/unexpected plaintext length/);
    expect(() =>
      encryptChunk(sodium, {
        fileKey,
        header,
        chunkIndex: 2,
        plaintext: randomPlaintext(100),
      }),
    ).toThrow(/out of range/);
  });
});
