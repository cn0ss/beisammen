import _sodium from 'libsodium-wrappers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { decryptBytes, generateCircleKey, type SodiumApi } from '@beisammen/crypto';

// In-memory stand-in for the new expo-file-system File/FileHandle API used by
// both file-crypto and upload-encryption.
const memoryFs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
}));

vi.mock('expo-file-system', () => {
  class MockFile {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return memoryFs.files.has(this.uri);
    }

    get size(): number {
      return memoryFs.files.get(this.uri)?.byteLength ?? 0;
    }

    create(): void {
      memoryFs.files.set(this.uri, new Uint8Array(0));
    }

    delete(): void {
      memoryFs.files.delete(this.uri);
    }

    async bytes(): Promise<Uint8Array> {
      const bytes = memoryFs.files.get(this.uri);

      if (!bytes) {
        throw new Error(`Missing file: ${this.uri}`);
      }

      return bytes.slice();
    }

    write(bytes: Uint8Array): void {
      memoryFs.files.set(this.uri, bytes.slice());
    }

    open(mode: string) {
      const uri = this.uri;

      if (mode === 'r') {
        const data = memoryFs.files.get(uri) ?? new Uint8Array(0);
        let offset = 0;

        return {
          readBytes(length: number): Uint8Array {
            const next = data.slice(offset, offset + length);
            offset += next.length;
            return next;
          },
          writeBytes(): void {
            throw new Error('Read-only handle.');
          },
          close(): void {},
        };
      }

      memoryFs.files.set(uri, memoryFs.files.get(uri) ?? new Uint8Array(0));

      return {
        readBytes(): Uint8Array {
          throw new Error('Write-only handle.');
        },
        writeBytes(bytes: Uint8Array): void {
          const current = memoryFs.files.get(uri) ?? new Uint8Array(0);
          const next = new Uint8Array(current.length + bytes.length);
          next.set(current);
          next.set(bytes, current.length);
          memoryFs.files.set(uri, next);
        },
        close(): void {},
      };
    }
  }

  return {
    File: MockFile,
    FileMode: { ReadOnly: 'r', WriteOnly: 'w', ReadWrite: 'rw' },
  };
});

// The app resolves sodium via react-native-libsodium, which cannot load in
// Node; tests use the wasm libsodium-wrappers build instead (same API).
vi.mock('@/features/crypto/sodium', () => ({
  getSodium: async () => {
    await _sodium.ready;
    return _sodium as unknown as SodiumApi;
  },
}));

import { openAssetMetadata, unwrapAssetFileKey } from '@/features/crypto/asset-metadata';
import { decryptFileToFile } from '@/features/crypto/file-crypto';

import {
  encryptedCompletionFields,
  genericUploadFileName,
  resolveUploadEncryption,
} from './upload-encryption';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  memoryFs.files.clear();
});

function seedFile(uri: string, bytes: Uint8Array): void {
  memoryFs.files.set(uri, bytes.slice());
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

const location = {
  latitude: 48.1351,
  longitude: 11.582,
  source: 'embedded' as const,
  city: 'München',
};

describe('genericUploadFileName', () => {
  test('keeps only the extension of the original name', () => {
    expect(genericUploadFileName('Familie-Sommerfest-2026.JPEG', 'image')).toBe('upload.jpeg');
    expect(genericUploadFileName('Urlaub.mov', 'video')).toBe('upload.mov');
  });

  test('falls back to a kind-specific extension', () => {
    expect(genericUploadFileName('unbenannt', 'image')).toBe('upload.jpg');
    expect(genericUploadFileName('unbenannt', 'video')).toBe('upload.mp4');
  });
});

describe('resolveUploadEncryption', () => {
  test('encrypts original and preview so only ciphertext and the sealed envelope remain', async () => {
    const source = randomBytes(2048);
    const preview = randomBytes(512);

    seedFile('file:///cache/source.jpg', source);
    seedFile('file:///cache/preview.jpg', preview);

    const circleKey = generateCircleKey(sodium);
    const result = await resolveUploadEncryption({
      circleKey: { epoch: 3, circleKey },
      metadata: { fileName: 'Familie-Sommerfest.jpg', location },
      sourceUri: 'file:///cache/source.jpg',
      previewUri: 'file:///cache/preview.jpg',
      encryptedTargetUri: 'file:///recovery/item-encrypted.bin',
      encryptedPreviewTargetUri: 'file:///recovery/item-encrypted-preview.bin',
    });

    expect(result.envelope).toMatchObject({ v: 1, circleEpoch: 3 });
    expect(result.envelope.wrappedFileKey.length).toBeGreaterThan(0);
    expect(result.encryptedSizeBytes).toBe(
      memoryFs.files.get('file:///recovery/item-encrypted.bin')?.byteLength,
    );
    expect(result.encryptedPreviewSizeBytes).toBe(
      memoryFs.files.get('file:///recovery/item-encrypted-preview.bin')?.byteLength,
    );

    // Both uploads round-trip through the envelope's wrapped key.
    const fileKey = unwrapAssetFileKey({
      sodium,
      envelope: result.envelope,
      keysByEpoch: new Map([[3, circleKey]]),
    });

    await decryptFileToFile({
      sodium,
      fileKey,
      sourceUri: result.encryptedUri,
      targetUri: 'file:///cache/decrypted.jpg',
    });
    expect(memoryFs.files.get('file:///cache/decrypted.jpg')).toEqual(source);
    expect(
      decryptBytes(sodium, {
        fileKey,
        ciphertext: memoryFs.files.get(result.encryptedPreviewUri)!,
      }),
    ).toEqual(preview);

    // Name and location travel only inside the encrypted metadata.
    expect(
      openAssetMetadata({ sodium, fileKey, encMetadata: result.envelope.encMetadata! }),
    ).toEqual({
      v: 1,
      fileName: 'Familie-Sommerfest.jpg',
      location,
    });
  });

  test('reuses persisted ciphertext and envelope without needing the circle key', async () => {
    const encryptedBytes = randomBytes(333);
    const encryptedPreviewBytes = randomBytes(99);

    seedFile('file:///recovery/persisted-encrypted.bin', encryptedBytes);
    seedFile('file:///recovery/persisted-encrypted-preview.bin', encryptedPreviewBytes);

    const envelope = {
      v: 1 as const,
      circleEpoch: 2,
      wrappedFileKey: 'wrapped',
      encMetadata: 'sealed-metadata',
    };
    const result = await resolveUploadEncryption({
      circleKey: null,
      metadata: { fileName: 'photo.jpg' },
      sourceUri: 'file:///cache/source.jpg',
      previewUri: 'file:///cache/preview.jpg',
      encryptedTargetUri: 'file:///recovery/unused.bin',
      encryptedPreviewTargetUri: 'file:///recovery/unused-preview.bin',
      persisted: {
        encryptedCacheUri: 'file:///recovery/persisted-encrypted.bin',
        encryptedPreviewCacheUri: 'file:///recovery/persisted-encrypted-preview.bin',
        encryption: envelope,
      },
    });

    expect(result).toEqual({
      encryptedUri: 'file:///recovery/persisted-encrypted.bin',
      encryptedPreviewUri: 'file:///recovery/persisted-encrypted-preview.bin',
      encryptedSizeBytes: 333,
      encryptedPreviewSizeBytes: 99,
      envelope,
    });
    // The byte-identical ciphertext was reused, not rewritten.
    expect(memoryFs.files.get('file:///recovery/persisted-encrypted.bin')).toEqual(encryptedBytes);
    expect(memoryFs.files.has('file:///recovery/unused.bin')).toBe(false);
  });

  test('falls back to fresh encryption when persisted ciphertext files are gone', async () => {
    seedFile('file:///cache/source.jpg', randomBytes(64));
    seedFile('file:///cache/preview.jpg', randomBytes(16));

    const result = await resolveUploadEncryption({
      circleKey: { epoch: 1, circleKey: generateCircleKey(sodium) },
      metadata: { fileName: 'photo.jpg' },
      sourceUri: 'file:///cache/source.jpg',
      previewUri: 'file:///cache/preview.jpg',
      encryptedTargetUri: 'file:///recovery/fresh.bin',
      encryptedPreviewTargetUri: 'file:///recovery/fresh-preview.bin',
      persisted: {
        encryptedCacheUri: 'file:///recovery/lost.bin',
        encryptedPreviewCacheUri: 'file:///recovery/lost-preview.bin',
        encryption: { v: 1, circleEpoch: 1, wrappedFileKey: 'wrapped' },
      },
    });

    expect(result.encryptedUri).toBe('file:///recovery/fresh.bin');
    expect(memoryFs.files.has('file:///recovery/fresh.bin')).toBe(true);
  });

  test('rejects fresh encryption while the circle key is not ready', async () => {
    seedFile('file:///cache/source.jpg', randomBytes(64));
    seedFile('file:///cache/preview.jpg', randomBytes(16));

    await expect(
      resolveUploadEncryption({
        circleKey: null,
        metadata: { fileName: 'photo.jpg' },
        sourceUri: 'file:///cache/source.jpg',
        previewUri: 'file:///cache/preview.jpg',
        encryptedTargetUri: 'file:///recovery/fresh.bin',
        encryptedPreviewTargetUri: 'file:///recovery/fresh-preview.bin',
      }),
    ).rejects.toThrow(/Verschlüsselungsschlüssel/);
  });
});

describe('encryptedCompletionFields', () => {
  test('sends the envelope and generic name but never a plaintext location', () => {
    const envelope = {
      v: 1 as const,
      circleEpoch: 4,
      wrappedFileKey: 'wrapped',
      encMetadata: 'sealed',
    };
    const fields = encryptedCompletionFields({
      fileName: 'Familie-Sommerfest.jpg',
      kind: 'image',
      encrypted: { encryptedSizeBytes: 4321, envelope },
      asset: {
        width: 1200,
        height: 800,
        durationSeconds: undefined,
        capturedAt: 1_754_000_000_000,
      },
    });

    expect(fields).toEqual({
      fileName: 'upload.jpg',
      sizeBytes: 4321,
      width: 1200,
      height: 800,
      durationSeconds: undefined,
      capturedAt: 1_754_000_000_000,
      encryption: envelope,
    });
    expect('location' in fields).toBe(false);
  });
});
