import _sodium from 'libsodium-wrappers';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
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

const proxyServer = vi.hoisted(() => ({
  registered: [] as unknown[],
  unregistered: [] as string[],
}));

vi.mock('./server', () => ({
  registerVideoSession: async (session: unknown) => {
    proxyServer.registered.push(session);

    return {
      token: `tok${proxyServer.registered.length}`,
      url: `http://127.0.0.1:45111/v/tok${proxyServer.registered.length}`,
    };
  },
  unregisterVideoSession: (token: string) => {
    proxyServer.unregistered.push(token);
  },
}));

import { encryptBytes, generateCircleKey, type SodiumApi } from '@beisammen/crypto';

import { sealAssetEncryption } from '@/features/crypto/asset-metadata';
import { resetFakeFileSystem, seedFile } from '@/test/fake-file-system';

import { DECRYPTED_CACHE_DIRECTORY } from '../decrypted-cache';
import { openEncryptedVideoStream } from './playback';
import type { EncryptedVideoSession } from './session';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  resetFakeFileSystem();
  proxyServer.registered = [];
  proxyServer.unregistered = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEncryptedVideoAsset() {
  const circleKey = generateCircleKey(sodium);
  const { fileKey, envelope } = sealAssetEncryption({
    sodium,
    circleKey,
    circleEpoch: 2,
    metadata: { v: 1, fileName: 'urlaub.mp4' },
  });

  return {
    fileKey,
    keysByEpoch: new Map([[2, circleKey]]),
    asset: {
      _id: 'asset1',
      kind: 'video' as const,
      mimeType: 'video/mp4',
      encryption: envelope,
    },
  };
}

describe('openEncryptedVideoStream', () => {
  test('prefers a fully decrypted cache file over the proxy', async () => {
    const { asset, keysByEpoch } = makeEncryptedVideoAsset();
    const cachedUri = `${DECRYPTED_CACHE_DIRECTORY}circle1/asset1-original.mp4`;

    seedFile(cachedUri, new Uint8Array([1, 2, 3]));

    const stream = await openEncryptedVideoStream({
      circleId: 'circle1',
      asset,
      keysByEpoch,
      getSignedUrl: async () => ({ url: 'https://r2.example/cipher', expiresAt: null }),
    });

    expect(stream.uri).toBe(cachedUri);
    expect(proxyServer.registered).toHaveLength(0);

    stream.close();
    expect(proxyServer.unregistered).toHaveLength(0);
  });

  test('registers a session that decrypts ciphertext fetched from R2', async () => {
    const { asset, fileKey, keysByEpoch } = makeEncryptedVideoAsset();
    const plaintext = sodium.randombytes_buf(300);
    const ciphertext = encryptBytes(sodium, { fileKey, plaintext, chunkSize: 100 });

    vi.stubGlobal(
      'fetch',
      async (_url: string, init: { headers: Record<string, string> }) => {
        const match = /bytes=(\d+)-(\d+)/.exec(init.headers.range);

        if (!match) {
          throw new Error('Expected a ranged request.');
        }

        const body = ciphertext.slice(Number(match[1]), Number(match[2]) + 1);

        return {
          status: 206,
          arrayBuffer: async () =>
            body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        };
      },
    );

    const stream = await openEncryptedVideoStream({
      circleId: 'circle1',
      asset,
      keysByEpoch,
      getSignedUrl: async () => ({ url: 'https://r2.example/cipher', expiresAt: null }),
    });

    expect(stream.uri).toBe('http://127.0.0.1:45111/v/tok1');
    expect(proxyServer.registered).toHaveLength(1);

    // The registered session must hold the correctly unwrapped file key:
    // header bootstrap plus chunk decryption yield the original plaintext.
    const session = proxyServer.registered[0] as EncryptedVideoSession;
    const header = await session.ensureHeader();

    expect(session.mimeType).toBe('video/mp4');
    expect(header.plaintextLength).toBe(300);
    expect(await session.decryptChunkAt(header, 1)).toEqual(plaintext.subarray(100, 200));

    stream.close();
    stream.close();
    expect(proxyServer.unregistered).toEqual(['tok1']);
  });

  test('concurrent opens of the same asset share one proxy session', async () => {
    const { asset, keysByEpoch } = makeEncryptedVideoAsset();
    const getSignedUrl = async () => ({ url: 'https://r2.example/cipher', expiresAt: null });

    const [first, second] = await Promise.all([
      openEncryptedVideoStream({ circleId: 'circle1', asset, keysByEpoch, getSignedUrl }),
      openEncryptedVideoStream({ circleId: 'circle1', asset, keysByEpoch, getSignedUrl }),
    ]);

    expect(proxyServer.registered).toHaveLength(1);
    expect(second.uri).toBe(first.uri);

    // The session stays registered until the last consumer closes.
    first.close();
    first.close();
    expect(proxyServer.unregistered).toHaveLength(0);

    second.close();
    expect(proxyServer.unregistered).toEqual(['tok1']);

    // After full release, a new open registers a fresh session.
    const third = await openEncryptedVideoStream({
      circleId: 'circle1',
      asset,
      keysByEpoch,
      getSignedUrl,
    });

    expect(proxyServer.registered).toHaveLength(2);
    third.close();
  });

  test('rejects when no circle key covers the asset epoch', async () => {
    const { asset } = makeEncryptedVideoAsset();

    await expect(
      openEncryptedVideoStream({
        circleId: 'circle1',
        asset,
        keysByEpoch: new Map(),
        getSignedUrl: async () => ({ url: 'https://r2.example/cipher', expiresAt: null }),
      }),
    ).rejects.toThrow('No circle key available for epoch 2.');
  });
});
