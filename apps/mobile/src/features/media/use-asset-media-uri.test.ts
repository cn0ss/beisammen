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
// The hook itself needs a renderer; these mocks keep the module importable in
// Node so the exported resolution core can be exercised directly.
vi.mock('convex/react', () => ({ useAction: vi.fn() }));
vi.mock('@/features/crypto/use-circle-keys', () => ({
  useCircleKeys: vi.fn(() => ({ status: 'loading' })),
}));
// The video-proxy server pulls in the native TCP module and the RN logger;
// neither loads in Node, and the resolution core never touches them.
vi.mock('react-native-tcp-socket', () => ({ default: { createServer: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { generateCircleKey, type SodiumApi } from '@beisammen/crypto';

import { sealAssetEncryption } from '@/features/crypto/asset-metadata';
import { encryptFileToFile } from '@/features/crypto/file-crypto';
import {
  fakeFsState,
  readFile,
  registerDownload,
  resetFakeFileSystem,
  seedFile,
} from '@/test/fake-file-system';

import { DECRYPTED_CACHE_DIRECTORY, resetDecryptedCacheForTesting } from './decrypted-cache';
import { resolveAssetMediaUri } from './use-asset-media-uri';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  resetFakeFileSystem();
  resetDecryptedCacheForTesting();
});

describe('resolveAssetMediaUri', () => {
  test('plaintext legacy assets resolve to their signed URL without touching the cache', async () => {
    const uri = await resolveAssetMediaUri({
      asset: { _id: 'asset1', kind: 'image', mimeType: 'image/jpeg' },
      variant: 'preview',
      getSignedUrl: async () => 'https://cdn.example/signed',
    });

    expect(uri).toBe('https://cdn.example/signed');
    expect(fakeFsState.downloadCount).toBe(0);
  });

  test('encrypted assets stay null while circle keys are unavailable', async () => {
    const circleKey = generateCircleKey(sodium);
    const { envelope } = sealAssetEncryption({
      sodium,
      circleKey,
      circleEpoch: 1,
      metadata: { v: 1 },
    });

    const uri = await resolveAssetMediaUri({
      asset: { _id: 'asset1', kind: 'image', mimeType: 'image/jpeg', encryption: envelope },
      variant: 'preview',
      getSignedUrl: async () => 'https://cdn.example/cipher',
    });

    expect(uri).toBeNull();
    expect(fakeFsState.downloadCount).toBe(0);
  });

  test('encrypted assets resolve to a decrypted local file once keys are present', async () => {
    const plaintext = new Uint8Array(2048).map((_, index) => (index * 7) % 256);
    const circleKey = generateCircleKey(sodium);
    const { fileKey, envelope } = sealAssetEncryption({
      sodium,
      circleKey,
      circleEpoch: 3,
      metadata: { v: 1, fileName: 'geheim.jpg' },
    });

    seedFile('file:///plain.bin', plaintext);
    await encryptFileToFile({
      sodium,
      fileKey,
      sourceUri: 'file:///plain.bin',
      targetUri: 'file:///cipher.bin',
    });
    registerDownload('https://cdn.example/cipher', readFile('file:///cipher.bin')!);

    const uri = await resolveAssetMediaUri({
      asset: { _id: 'asset1', kind: 'image', mimeType: 'image/jpeg', encryption: envelope },
      variant: 'original',
      getSignedUrl: async () => 'https://cdn.example/cipher',
      keysByEpoch: new Map([[3, circleKey]]),
    });

    expect(uri).toBe(`${DECRYPTED_CACHE_DIRECTORY}asset1-original.jpg`);
    expect(readFile(uri!)).toEqual(plaintext);
  });
});
