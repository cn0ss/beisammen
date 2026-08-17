import {
  unwrapAssetFileKey,
  type AssetEncryptionEnvelope,
} from '@/features/crypto/asset-metadata';
import { getSodium } from '@/features/crypto/sodium';

import { peekDecryptedAssetUri } from '../decrypted-cache';
import { registerVideoSession, unregisterVideoSession } from './server';
import { EncryptedVideoSession, type SignedUrlProvider } from './session';

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

/**
 * Playback entry point for encrypted originals of videos. Prefers a fully
 * decrypted file already sitting in the display cache; otherwise unwraps the
 * file key (memory only), builds an `EncryptedVideoSession` that streams
 * ciphertext ranges straight from R2, and registers it with the local proxy.
 */
export async function openEncryptedVideoStream(input: {
  asset: EncryptedVideoStreamAsset;
  keysByEpoch: Map<number, Uint8Array>;
  getSignedUrl: SignedUrlProvider;
}): Promise<EncryptedVideoStream> {
  const cachedUri = await peekDecryptedAssetUri(input.asset, 'original');

  if (cachedUri) {
    return { uri: cachedUri, close: () => undefined };
  }

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
  const { token, url } = await registerVideoSession(session);
  let closed = false;

  return {
    uri: url,
    close: () => {
      if (!closed) {
        closed = true;
        unregisterVideoSession(token);
      }
    },
  };
}
