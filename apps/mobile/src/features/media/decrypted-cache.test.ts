import _sodium from 'libsodium-wrappers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('expo-file-system', async () =>
  (await import('@/test/fake-file-system')).createModernFileSystemMock(),
);
vi.mock('expo-file-system/legacy', async () =>
  (await import('@/test/fake-file-system')).createLegacyFileSystemMock(),
);
vi.mock('@/features/crypto/sodium', async () => {
  const sodium = (await import('libsodium-wrappers')).default;

  return {
    getSodium: async () => {
      await sodium.ready;
      return sodium as unknown as import('@beisammen/crypto').SodiumApi;
    },
  };
});

import { generateCircleKey, type SodiumApi } from '@beisammen/crypto';

import {
  sealAssetEncryption,
  type AssetEncryptionEnvelope,
} from '@/features/crypto/asset-metadata';
import { encryptFileToFile } from '@/features/crypto/file-crypto';
import {
  fakeFsState,
  readFile,
  registerDownload,
  resetFakeFileSystem,
  seedFile,
} from '@/test/fake-file-system';

import {
  DECRYPTED_CACHE_DIRECTORY,
  clearCircleDecryptedMedia,
  decryptedCacheFileName,
  enforceDecryptedCacheLimit,
  getDecryptedAssetUri,
  peekDecryptedAssetUri,
  peekMemoizedDecryptedUri,
  reconcileDecryptedMediaCache,
  resetDecryptedCacheForTesting,
} from './decrypted-cache';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  resetFakeFileSystem();
  resetDecryptedCacheForTesting();
});

interface EncryptedFixture {
  plaintext: Uint8Array;
  ciphertext: Uint8Array;
  envelope: AssetEncryptionEnvelope;
  circleKey: Uint8Array;
}

async function createEncryptedFixture(plaintext: Uint8Array): Promise<EncryptedFixture> {
  const circleKey = generateCircleKey(sodium);
  const { fileKey, envelope } = sealAssetEncryption({
    sodium,
    circleKey,
    circleEpoch: 1,
    metadata: { v: 1, fileName: 'original.jpg' },
  });

  seedFile('file:///plain.bin', plaintext);
  await encryptFileToFile({
    sodium,
    fileKey,
    sourceUri: 'file:///plain.bin',
    targetUri: 'file:///cipher.bin',
  });

  const ciphertext = readFile('file:///cipher.bin');

  if (!ciphertext) {
    throw new Error('fixture encryption failed');
  }

  return { plaintext, ciphertext, envelope, circleKey };
}

describe('decryptedCacheFileName', () => {
  test('keys files deterministically by asset id, variant, and mime type', () => {
    expect(
      decryptedCacheFileName({ _id: 'a1', kind: 'image', mimeType: 'image/jpeg' }, 'preview'),
    ).toBe('a1-preview.jpg');
    expect(
      decryptedCacheFileName({ _id: 'a1', kind: 'image', mimeType: 'image/png' }, 'original'),
    ).toBe('a1-original.png');
    expect(
      decryptedCacheFileName({ _id: 'a2', kind: 'video', mimeType: 'video/mp4' }, 'original'),
    ).toBe('a2-original.mp4');
    expect(
      decryptedCacheFileName({ _id: 'a2', kind: 'video', mimeType: 'video/quicktime' }, 'original'),
    ).toBe('a2-original.mov');
    // Previews are always JPEG thumbnails, for videos too.
    expect(
      decryptedCacheFileName({ _id: 'a2', kind: 'video', mimeType: 'video/mp4' }, 'preview'),
    ).toBe('a2-preview.jpg');
    // Unknown mime types fall back by kind.
    expect(decryptedCacheFileName({ _id: 'a3', kind: 'video' }, 'original')).toBe(
      'a3-original.mp4',
    );
    // Live Photo paired clips key off their own mime type.
    expect(
      decryptedCacheFileName(
        { _id: 'a4', kind: 'image', mimeType: 'image/heic', pairedVideoMimeType: 'video/quicktime' },
        'pairedVideo',
      ),
    ).toBe('a4-pairedVideo.mov');
    expect(
      decryptedCacheFileName({ _id: 'a4', kind: 'image', mimeType: 'image/heic' }, 'pairedVideo'),
    ).toBe('a4-pairedVideo.mp4');
  });
});

describe('getDecryptedAssetUri', () => {
  const plaintext = new Uint8Array(3000).map((_, index) => index % 251);

  test('downloads, decrypts, and caches the plaintext file', async () => {
    const fixture = await createEncryptedFixture(plaintext);

    registerDownload('https://cdn.example/cipher', fixture.ciphertext);

    const uri = await getDecryptedAssetUri({
      circleId: 'circle1',
      asset: { _id: 'asset1', kind: 'image', mimeType: 'image/jpeg', encryption: fixture.envelope },
      variant: 'original',
      signedUrl: 'https://cdn.example/cipher',
      keysByEpoch: new Map([[1, fixture.circleKey]]),
    });

    expect(uri).toBe(`${DECRYPTED_CACHE_DIRECTORY}circle1/asset1-original.jpg`);
    expect(readFile(uri)).toEqual(plaintext);
    // Ciphertext and partial temp files are removed after the decrypt.
    expect(readFile(`${uri}.ciphertext`)).toBeUndefined();
    expect(readFile(`${uri}.partial`)).toBeUndefined();
  });

  test('serves cache hits without downloading again', async () => {
    const fixture = await createEncryptedFixture(plaintext);

    registerDownload('https://cdn.example/cipher', fixture.ciphertext);

    const input = {
      circleId: 'circle1',
      asset: {
        _id: 'asset1',
        kind: 'image' as const,
        mimeType: 'image/jpeg',
        encryption: fixture.envelope,
      },
      variant: 'original' as const,
      keysByEpoch: new Map([[1, fixture.circleKey]]),
    };
    const first = await getDecryptedAssetUri({ ...input, signedUrl: 'https://cdn.example/cipher' });
    const downloadsAfterFirst = fakeFsState.downloadCount;
    const second = await getDecryptedAssetUri({
      ...input,
      getSignedUrl: async () => {
        throw new Error('must not be called on a cache hit');
      },
    });

    expect(second).toBe(first);
    expect(fakeFsState.downloadCount).toBe(downloadsAfterFirst);
  });

  test('deduplicates concurrent requests for the same asset and variant', async () => {
    const fixture = await createEncryptedFixture(plaintext);

    registerDownload('https://cdn.example/cipher', fixture.ciphertext);

    const input = {
      circleId: 'circle1',
      asset: {
        _id: 'asset1',
        kind: 'image' as const,
        mimeType: 'image/jpeg',
        encryption: fixture.envelope,
      },
      variant: 'original' as const,
      signedUrl: 'https://cdn.example/cipher',
      keysByEpoch: new Map([[1, fixture.circleKey]]),
    };
    const [first, second] = await Promise.all([
      getDecryptedAssetUri(input),
      getDecryptedAssetUri(input),
    ]);

    expect(first).toBe(second);
    expect(fakeFsState.downloadCount).toBe(1);
  });

  test('fails when no circle key matches the envelope epoch', async () => {
    const fixture = await createEncryptedFixture(plaintext);

    registerDownload('https://cdn.example/cipher', fixture.ciphertext);

    await expect(
      getDecryptedAssetUri({
        circleId: 'circle1',
        asset: {
          _id: 'asset1',
          kind: 'image',
          mimeType: 'image/jpeg',
          encryption: fixture.envelope,
        },
        variant: 'original',
        signedUrl: 'https://cdn.example/cipher',
        keysByEpoch: new Map(),
      }),
    ).rejects.toThrow(/epoch/i);
  });

  test('memoizes resolved uris for synchronous peeking', async () => {
    const fixture = await createEncryptedFixture(plaintext);
    const asset = {
      _id: 'asset1',
      kind: 'image' as const,
      mimeType: 'image/jpeg',
      encryption: fixture.envelope,
    };

    registerDownload('https://cdn.example/cipher', fixture.ciphertext);

    expect(peekMemoizedDecryptedUri('circle1', asset, 'original')).toBeNull();

    const uri = await getDecryptedAssetUri({
      circleId: 'circle1',
      asset,
      variant: 'original',
      signedUrl: 'https://cdn.example/cipher',
      keysByEpoch: new Map([[1, fixture.circleKey]]),
    });

    expect(peekMemoizedDecryptedUri('circle1', asset, 'original')).toBe(uri);
    expect(peekMemoizedDecryptedUri('circle2', asset, 'original')).toBeNull();
  });
});

describe('peekDecryptedAssetUri', () => {
  const asset = { _id: 'asset1', kind: 'image' as const, mimeType: 'image/jpeg' };

  test('returns the cached file without downloading and seeds the memo', async () => {
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/asset1-original.jpg`, new Uint8Array(4));

    const uri = await peekDecryptedAssetUri('circle1', asset, 'original');

    expect(uri).toBe(`${DECRYPTED_CACHE_DIRECTORY}circle1/asset1-original.jpg`);
    expect(peekMemoizedDecryptedUri('circle1', asset, 'original')).toBe(uri);
    expect(fakeFsState.downloadCount).toBe(0);
  });

  test('returns null and drops a stale memo when the file is gone', async () => {
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/asset1-original.jpg`, new Uint8Array(4));
    await peekDecryptedAssetUri('circle1', asset, 'original');

    fakeFsState.files.delete(`${DECRYPTED_CACHE_DIRECTORY}circle1/asset1-original.jpg`);

    expect(await peekDecryptedAssetUri('circle1', asset, 'original')).toBeNull();
    expect(peekMemoizedDecryptedUri('circle1', asset, 'original')).toBeNull();
  });
});

describe('clearCircleDecryptedMedia', () => {
  test('removes only the given circle\'s files and memo entries', async () => {
    const asset = { _id: 'a1', kind: 'image' as const, mimeType: 'image/jpeg' };

    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a1-preview.jpg`, new Uint8Array(4));
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle2/a1-preview.jpg`, new Uint8Array(4));
    await peekDecryptedAssetUri('circle1', asset, 'preview');
    await peekDecryptedAssetUri('circle2', asset, 'preview');

    await clearCircleDecryptedMedia('circle1');

    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a1-preview.jpg`)).toBeUndefined();
    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle2/a1-preview.jpg`)).toBeDefined();
    expect(peekMemoizedDecryptedUri('circle1', asset, 'preview')).toBeNull();
    expect(peekMemoizedDecryptedUri('circle2', asset, 'preview')).not.toBeNull();
  });
});

describe('reconcileDecryptedMediaCache', () => {
  test('drops circles missing from the membership list and keeps the rest', async () => {
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a1-preview.jpg`, new Uint8Array(4));
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle2/a2-preview.jpg`, new Uint8Array(4));

    await reconcileDecryptedMediaCache(['circle2']);

    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a1-preview.jpg`)).toBeUndefined();
    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle2/a2-preview.jpg`)).toBeDefined();
  });

  test('drops legacy flat-layout files from before circle scoping', async () => {
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}a1-original.jpg`, new Uint8Array(4));
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a1-preview.jpg`, new Uint8Array(4));

    await reconcileDecryptedMediaCache(['circle1']);

    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}a1-original.jpg`)).toBeUndefined();
    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a1-preview.jpg`)).toBeDefined();
  });
});

describe('enforceDecryptedCacheLimit', () => {
  test('deletes oldest files first across circles until the cap fits', async () => {
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/old-original.jpg`, new Uint8Array(40), 1);
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle2/middle-original.jpg`, new Uint8Array(40), 2);
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/new-original.jpg`, new Uint8Array(40), 3);

    await enforceDecryptedCacheLimit(80);

    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/old-original.jpg`)).toBeUndefined();
    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle2/middle-original.jpg`)).toBeDefined();
    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/new-original.jpg`)).toBeDefined();
  });

  test('leaves the directory alone while it is under the cap', async () => {
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a-original.jpg`, new Uint8Array(10), 1);
    seedFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/b-original.jpg`, new Uint8Array(10), 2);

    await enforceDecryptedCacheLimit(80);

    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/a-original.jpg`)).toBeDefined();
    expect(readFile(`${DECRYPTED_CACHE_DIRECTORY}circle1/b-original.jpg`)).toBeDefined();
  });
});
