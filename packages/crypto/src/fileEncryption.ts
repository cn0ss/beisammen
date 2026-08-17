import { concatBytes, toBase64 } from './encoding';
import {
  XCHACHA_NONCE_BYTES,
  XCHACHA_TAG_BYTES,
  type SodiumApi,
} from './sodium';
import { assertKeyLength } from './wrap';

/**
 * Beisammen encrypted media format v1 ("BSE1").
 *
 * Layout: 36-byte header, then fixed-size encrypted chunks. Every chunk is
 * XChaCha20-Poly1305 with nonce = fileNonce(16) || chunkIndex(u64 LE) and
 * AD = base64(header || finalFlagByte) as a UTF-8 string. Chunks are
 * independently decryptable, so byte ranges of large videos can be fetched
 * and decrypted for playback/seeking without downloading the whole file;
 * the authenticated plaintext length and final flag rule out truncation and
 * reordering.
 */
export const FILE_MAGIC = new Uint8Array([0x42, 0x53, 0x45, 0x31]); // "BSE1"
export const FILE_FORMAT_VERSION = 1;
export const FILE_ALGORITHM_XCHACHA_CHUNKED = 1;
export const FILE_HEADER_BYTES = 36;
export const FILE_NONCE_BYTES = 16;
export const DEFAULT_CHUNK_SIZE = 1024 * 1024;
export const CHUNK_OVERHEAD_BYTES = XCHACHA_TAG_BYTES;

export interface FileHeader {
  chunkSize: number;
  plaintextLength: number;
  fileNonce: Uint8Array;
  bytes: Uint8Array;
}

export function createFileHeader(
  sodium: SodiumApi,
  input: { plaintextLength: number; chunkSize?: number },
): FileHeader {
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;

  if (!Number.isSafeInteger(input.plaintextLength) || input.plaintextLength < 0) {
    throw new Error('Invalid plaintext length.');
  }

  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > 0xffffffff) {
    throw new Error('Invalid chunk size.');
  }

  const fileNonce = sodium.randombytes_buf(FILE_NONCE_BYTES);
  const bytes = new Uint8Array(FILE_HEADER_BYTES);
  const view = new DataView(bytes.buffer);

  bytes.set(FILE_MAGIC, 0);
  view.setUint8(4, FILE_FORMAT_VERSION);
  view.setUint8(5, FILE_ALGORITHM_XCHACHA_CHUNKED);
  view.setUint16(6, 0, true);
  view.setUint32(8, chunkSize, true);
  setUint64(view, 12, input.plaintextLength);
  bytes.set(fileNonce, 20);

  return { chunkSize, plaintextLength: input.plaintextLength, fileNonce, bytes };
}

export function parseFileHeader(bytes: Uint8Array): FileHeader {
  if (bytes.length < FILE_HEADER_BYTES) {
    throw new Error('Encrypted file header is truncated.');
  }

  const header = bytes.slice(0, FILE_HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  for (let index = 0; index < FILE_MAGIC.length; index += 1) {
    if (header[index] !== FILE_MAGIC[index]) {
      throw new Error('Not a Beisammen encrypted file.');
    }
  }

  if (view.getUint8(4) !== FILE_FORMAT_VERSION) {
    throw new Error(`Unsupported encrypted file version ${view.getUint8(4)}.`);
  }

  if (view.getUint8(5) !== FILE_ALGORITHM_XCHACHA_CHUNKED) {
    throw new Error(`Unsupported encryption algorithm ${view.getUint8(5)}.`);
  }

  const chunkSize = view.getUint32(8, true);
  const plaintextLength = getUint64(view, 12);

  if (chunkSize <= 0) {
    throw new Error('Invalid chunk size in encrypted file header.');
  }

  return {
    chunkSize,
    plaintextLength,
    fileNonce: header.slice(20, 20 + FILE_NONCE_BYTES),
    bytes: header,
  };
}

export function chunkCount(header: Pick<FileHeader, 'chunkSize' | 'plaintextLength'>): number {
  return header.plaintextLength === 0
    ? 1
    : Math.ceil(header.plaintextLength / header.chunkSize);
}

export function ciphertextLength(header: Pick<FileHeader, 'chunkSize' | 'plaintextLength'>): number {
  return FILE_HEADER_BYTES + header.plaintextLength + chunkCount(header) * CHUNK_OVERHEAD_BYTES;
}

function plaintextChunkLength(
  header: Pick<FileHeader, 'chunkSize' | 'plaintextLength'>,
  chunkIndex: number,
): number {
  const total = chunkCount(header);

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= total) {
    throw new Error(`Chunk index ${chunkIndex} is out of range.`);
  }

  return chunkIndex === total - 1
    ? header.plaintextLength - chunkIndex * header.chunkSize
    : header.chunkSize;
}

/** Byte range of one encrypted chunk within the ciphertext file (for range requests). */
export function ciphertextRangeForChunk(
  header: Pick<FileHeader, 'chunkSize' | 'plaintextLength'>,
  chunkIndex: number,
): { start: number; end: number } {
  const length = plaintextChunkLength(header, chunkIndex) + CHUNK_OVERHEAD_BYTES;
  const start = FILE_HEADER_BYTES + chunkIndex * (header.chunkSize + CHUNK_OVERHEAD_BYTES);

  return { start, end: start + length };
}

export function chunkIndexForPlaintextOffset(
  header: Pick<FileHeader, 'chunkSize' | 'plaintextLength'>,
  plaintextOffset: number,
): number {
  if (plaintextOffset < 0 || plaintextOffset >= Math.max(header.plaintextLength, 1)) {
    throw new Error(`Plaintext offset ${plaintextOffset} is out of range.`);
  }

  return Math.floor(plaintextOffset / header.chunkSize);
}

function chunkNonce(header: FileHeader, chunkIndex: number): Uint8Array {
  const nonce = new Uint8Array(XCHACHA_NONCE_BYTES);

  nonce.set(header.fileNonce, 0);
  setUint64(new DataView(nonce.buffer), FILE_NONCE_BYTES, chunkIndex);

  return nonce;
}

// The AD is passed as a base64 STRING (UTF-8 identical across libsodium
// implementations) because react-native-libsodium rejects binary AD inputs.
function chunkAdditionalData(header: FileHeader, isFinal: boolean): string {
  return toBase64(concatBytes(header.bytes, new Uint8Array([isFinal ? 1 : 0])));
}

export function encryptChunk(
  sodium: SodiumApi,
  input: { fileKey: Uint8Array; header: FileHeader; chunkIndex: number; plaintext: Uint8Array },
): Uint8Array {
  assertKeyLength(input.fileKey, 'file key');

  if (input.plaintext.length !== plaintextChunkLength(input.header, input.chunkIndex)) {
    throw new Error(`Chunk ${input.chunkIndex} has an unexpected plaintext length.`);
  }

  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    input.plaintext,
    chunkAdditionalData(input.header, input.chunkIndex === chunkCount(input.header) - 1),
    null,
    chunkNonce(input.header, input.chunkIndex),
    input.fileKey,
  );
}

export function decryptChunk(
  sodium: SodiumApi,
  input: { fileKey: Uint8Array; header: FileHeader; chunkIndex: number; ciphertext: Uint8Array },
): Uint8Array {
  assertKeyLength(input.fileKey, 'file key');

  const expectedLength = plaintextChunkLength(input.header, input.chunkIndex) + CHUNK_OVERHEAD_BYTES;

  if (input.ciphertext.length !== expectedLength) {
    throw new Error(`Chunk ${input.chunkIndex} has an unexpected ciphertext length.`);
  }

  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    input.ciphertext,
    chunkAdditionalData(input.header, input.chunkIndex === chunkCount(input.header) - 1),
    chunkNonce(input.header, input.chunkIndex),
    input.fileKey,
  );
}

/** Whole-buffer convenience for previews and other small payloads. */
export function encryptBytes(
  sodium: SodiumApi,
  input: { fileKey: Uint8Array; plaintext: Uint8Array; chunkSize?: number },
): Uint8Array {
  const header = createFileHeader(sodium, {
    plaintextLength: input.plaintext.length,
    ...(input.chunkSize !== undefined ? { chunkSize: input.chunkSize } : {}),
  });
  const parts: Uint8Array[] = [header.bytes];
  const total = chunkCount(header);

  for (let chunkIndex = 0; chunkIndex < total; chunkIndex += 1) {
    const start = chunkIndex * header.chunkSize;

    parts.push(
      encryptChunk(sodium, {
        fileKey: input.fileKey,
        header,
        chunkIndex,
        plaintext: input.plaintext.subarray(
          start,
          Math.min(start + header.chunkSize, input.plaintext.length),
        ),
      }),
    );
  }

  return concatBytes(...parts);
}

export function decryptBytes(
  sodium: SodiumApi,
  input: { fileKey: Uint8Array; ciphertext: Uint8Array },
): Uint8Array {
  const header = parseFileHeader(input.ciphertext);

  if (input.ciphertext.length !== ciphertextLength(header)) {
    throw new Error('Encrypted file length does not match its header.');
  }

  const parts: Uint8Array[] = [];
  const total = chunkCount(header);

  for (let chunkIndex = 0; chunkIndex < total; chunkIndex += 1) {
    const range = ciphertextRangeForChunk(header, chunkIndex);

    parts.push(
      decryptChunk(sodium, {
        fileKey: input.fileKey,
        header,
        chunkIndex,
        ciphertext: input.ciphertext.subarray(range.start, range.end),
      }),
    );
  }

  return concatBytes(...parts);
}

function setUint64(view: DataView, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Value does not fit into a safe integer.');
  }

  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 0x100000000), true);
}

function getUint64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  const value = high * 0x100000000 + low;

  if (!Number.isSafeInteger(value)) {
    throw new Error('Stored length does not fit into a safe integer.');
  }

  return value;
}
