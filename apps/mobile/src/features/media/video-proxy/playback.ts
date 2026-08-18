import {
  unwrapAssetFileKey,
  type AssetEncryptionEnvelope,
} from '@/features/crypto/asset-metadata';
import { getSodium } from '@/features/crypto/sodium';

import { peekDecryptedAssetUri } from '../decrypted-cache';
import { createVideoPerfLogger } from '../video-logging';
import { registerVideoSession, unregisterVideoSession } from './server';
import { EncryptedVideoSession, type SignedUrlProvider } from './session';

const logger = createVideoPerfLogger('media.videoStream');

export interface EncryptedVideoStreamAsset {
  _id: string;
  kind: 'image' | 'video';
  mimeType?: string;
  encryption: AssetEncryptionEnvelope;
}

export interface EncryptedVideoStream {
  /** URI for the video player: a cached `file://` plaintext or a proxy URL. */
  uri: string;
  /** Unregisters the proxy session (no-op for cache hits). Idempotent. */
  close(): void;
}

interface OpenEncryptedVideoStreamInput {
  circleId: string;
  asset: EncryptedVideoStreamAsset;
  keysByEpoch: Map<number, Uint8Array>;
  getSignedUrl: SignedUrlProvider;
}

interface SharedEncryptedStream {
  uri: string;
  /** Proxy session token; `null` for decrypted-cache hits. */
  token: string | null;
}

/**
 * Open streams by asset. Several hooks resolve the same asset at once (the
 * active slide and the screen-level save/share hook); without sharing, each
 * would register its own proxy session and duplicate every ciphertext fetch.
 * Entries are ref-counted and removed when the last consumer closes.
 */
const sharedStreams = new Map<string, { refs: number; open: Promise<SharedEncryptedStream> }>();

async function openFreshStream(
  input: OpenEncryptedVideoStreamInput,
): Promise<SharedEncryptedStream> {
  const openedAt = Date.now();
  const cachedUri = await peekDecryptedAssetUri(input.circleId, input.asset, 'original');
  const cachePeekMs = Date.now() - openedAt;

  if (cachedUri) {
    logger.debug('Encrypted video stream served from decrypted cache.', {
      assetId: input.asset._id,
      cachePeekMs,
    });

    return { uri: cachedUri, token: null };
  }

  const unwrapStartedAt = Date.now();
  const sodium = await getSodium();
  const session = new EncryptedVideoSession({
    sodium,
    fileKey: unwrapAssetFileKey({
      sodium,
      envelope: input.asset.encryption,
      keysByEpoch: input.keysByEpoch,
    }),
    mimeType: input.asset.mimeType ?? 'video/mp4',
    getSignedUrl: input.getSignedUrl,
  });
  const unwrapMs = Date.now() - unwrapStartedAt;

  // Fire-and-forget: fetch the head and tail ranges AVPlayer probes first,
  // before it even asks. Errors surface on the real request path instead.
  session.warmUp().catch(() => undefined);

  const registerStartedAt = Date.now();
  const { token, url } = await registerVideoSession(session);

  logger.debug('Encrypted video stream registered with proxy.', {
    assetId: input.asset._id,
    cachePeekMs,
    unwrapMs,
    // Includes proxy server startup on the first playback of the app session.
    registerMs: Date.now() - registerStartedAt,
    totalMs: Date.now() - openedAt,
  });

  return { uri: url, token };
}

/**
 * Playback entry point for encrypted originals of videos. Prefers a fully
 * decrypted file already sitting in the display cache; otherwise unwraps the
 * file key (memory only), builds an `EncryptedVideoSession` that streams
 * ciphertext ranges straight from R2, and registers it with the local proxy.
 * Concurrent opens of the same asset share one session.
 */
export async function openEncryptedVideoStream(
  input: OpenEncryptedVideoStreamInput,
): Promise<EncryptedVideoStream> {
  const key = `${input.circleId}:${input.asset._id}`;
  let entry = sharedStreams.get(key);

  if (!entry) {
    const created = { refs: 0, open: openFreshStream(input) };

    // A failed open must not stay cached; consumers see the rejection below.
    created.open.catch(() => {
      if (sharedStreams.get(key) === created) {
        sharedStreams.delete(key);
      }
    });
    sharedStreams.set(key, created);
    entry = created;
  }

  const target = entry;

  target.refs += 1;

  let shared: SharedEncryptedStream;

  try {
    shared = await target.open;
  } catch (error) {
    target.refs -= 1;
    throw error;
  }

  let closed = false;

  return {
    uri: shared.uri,
    close: () => {
      if (closed) {
        return;
      }

      closed = true;
      target.refs -= 1;

      if (target.refs === 0 && sharedStreams.get(key) === target) {
        sharedStreams.delete(key);

        if (shared.token) {
          unregisterVideoSession(shared.token);
        }
      }
    },
  };
}
