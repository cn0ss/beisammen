import { File, FileMode } from 'expo-file-system';

import {
  FILE_HEADER_BYTES,
  chunkCount,
  ciphertextLength,
  ciphertextRangeForChunk,
  concatBytes,
  createFileHeader,
  decryptChunk,
  encryptChunk,
  parseFileHeader,
  type FileHeader,
  type SodiumApi,
} from '@beisammen/crypto';

/**
 * Streaming BSE1 file encryption/decryption over the new expo-file-system
 * FileHandle API: files of any size are processed chunk by chunk with bounded
 * memory, so unlimited-length videos never have to fit in RAM. The handle
 * calls are synchronous JSI; a yield between chunks keeps the UI responsive.
 */

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function readExact(
  handle: { readBytes(length: number): Uint8Array },
  length: number,
): Uint8Array {
  const first = handle.readBytes(length);

  if (first.length === length) {
    return first;
  }

  // Handles are allowed to return short reads; accumulate until complete.
  const parts: Uint8Array[] = [first];
  let received = first.length;

  while (received < length) {
    const next = handle.readBytes(length - received);

    if (next.length === 0) {
      throw new Error('Unexpected end of file while reading.');
    }

    parts.push(next);
    received += next.length;
  }

  return concatBytes(...parts);
}

function prepareTarget(targetUri: string): File {
  const target = new File(targetUri);

  if (target.exists) {
    target.delete();
  }

  target.create();

  return target;
}

export function encryptedSizeForPlaintextSize(plaintextLength: number, chunkSize?: number): number {
  const header = { plaintextLength, chunkSize: chunkSize ?? 1024 * 1024 };

  return ciphertextLength(header);
}

export async function encryptFileToFile(input: {
  sodium: SodiumApi;
  fileKey: Uint8Array;
  sourceUri: string;
  targetUri: string;
  chunkSize?: number;
}): Promise<{ header: FileHeader; plaintextLength: number; ciphertextLength: number }> {
  const source = new File(input.sourceUri);

  if (!source.exists) {
    throw new Error('Source file for encryption does not exist.');
  }

  const plaintextLength = source.size;
  const header = createFileHeader(input.sodium, {
    plaintextLength,
    ...(input.chunkSize !== undefined ? { chunkSize: input.chunkSize } : {}),
  });
  const target = prepareTarget(input.targetUri);
  const readHandle = source.open(FileMode.ReadOnly);
  const writeHandle = target.open(FileMode.WriteOnly);

  try {
    writeHandle.writeBytes(header.bytes);

    const totalChunks = chunkCount(header);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * header.chunkSize;
      const length = Math.min(header.chunkSize, plaintextLength - start);
      const plaintext = length > 0 ? readExact(readHandle, length) : new Uint8Array(0);

      writeHandle.writeBytes(
        encryptChunk(input.sodium, {
          fileKey: input.fileKey,
          header,
          chunkIndex,
          plaintext,
        }),
      );
      await yieldToEventLoop();
    }
  } finally {
    readHandle.close();
    writeHandle.close();
  }

  return {
    header,
    plaintextLength,
    ciphertextLength: ciphertextLength(header),
  };
}

export async function decryptFileToFile(input: {
  sodium: SodiumApi;
  fileKey: Uint8Array;
  sourceUri: string;
  targetUri: string;
}): Promise<{ plaintextLength: number }> {
  const source = new File(input.sourceUri);

  if (!source.exists) {
    throw new Error('Source file for decryption does not exist.');
  }

  const readHandle = source.open(FileMode.ReadOnly);
  let header: FileHeader;

  try {
    header = parseFileHeader(readExact(readHandle, FILE_HEADER_BYTES));

    if (source.size !== ciphertextLength(header)) {
      throw new Error('Encrypted file length does not match its header.');
    }

    const target = prepareTarget(input.targetUri);
    const writeHandle = target.open(FileMode.WriteOnly);

    try {
      const totalChunks = chunkCount(header);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const range = ciphertextRangeForChunk(header, chunkIndex);
        const ciphertext = readExact(readHandle, range.end - range.start);

        writeHandle.writeBytes(
          decryptChunk(input.sodium, {
            fileKey: input.fileKey,
            header,
            chunkIndex,
            ciphertext,
          }),
        );
        await yieldToEventLoop();
      }
    } finally {
      writeHandle.close();
    }
  } finally {
    readHandle.close();
  }

  return { plaintextLength: header.plaintextLength };
}
