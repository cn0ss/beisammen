import { useEffect, useState } from 'react';

import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';
import type { AssetEncryptionEnvelope } from '@/features/crypto/asset-metadata';
import { useCircleKeys } from '@/features/crypto/use-circle-keys';
import { createLogger } from '@/lib/logger';

import {
  getDecryptedAssetUri,
  peekDecryptedAssetUri,
  peekMemoizedDecryptedUri,
} from './decrypted-cache';
import { openEncryptedVideoStream } from './video-proxy/playback';

const logger = createLogger('media.assetUri');

/** Structural subset of an asset record the media hook needs to resolve a URI. */
export interface AssetMediaRef {
  _id: string;
  kind: 'image' | 'video';
  mimeType?: string;
  /** Set when the asset is a Live Photo; drives the 'pairedVideo' variant. */
  pairedVideoMimeType?: string;
  fileName?: string;
  encryption?: AssetEncryptionEnvelope | null;
}

export type AssetMediaVariant = 'preview' | 'original' | 'pairedVideo';

/**
 * Resolution core for images and previews, exported for tests. Plaintext
 * legacy assets resolve to their signed URL; encrypted assets resolve through
 * the decrypted cache to a local `file://` URI. A disk cache hit resolves
 * without keys; only fresh decrypts need `keysByEpoch`. Encrypted video
 * originals do not pass through here; they stream via the local
 * range-decrypting proxy (docs/e2ee.md, Phase 2).
 */
export async function resolveAssetMediaUri(input: {
  asset: AssetMediaRef;
  variant: AssetMediaVariant;
  circleId?: string | null;
  getSignedUrl: () => Promise<string | null>;
  keysByEpoch?: Map<number, Uint8Array>;
}): Promise<string | null> {
  const { encryption } = input.asset;

  if (!encryption) {
    return await input.getSignedUrl();
  }

  if (!input.circleId) {
    return null;
  }

  const cached = await peekDecryptedAssetUri(input.circleId, input.asset, input.variant);

  if (cached) {
    return cached;
  }

  if (!input.keysByEpoch) {
    return null;
  }

  return await getDecryptedAssetUri({
    circleId: input.circleId,
    asset: { ...input.asset, encryption },
    variant: input.variant,
    getSignedUrl: input.getSignedUrl,
    keysByEpoch: input.keysByEpoch,
  });
}

/**
 * Display URI for an asset: a signed remote URL for plaintext legacy assets,
 * a local decrypted file URI for encrypted images and previews, a loopback
 * proxy URL (or a cached local file) for encrypted video originals, `null`
 * while loading, decrypting, or waiting for a circle key grant (callers
 * already render placeholder states for null).
 *
 * Cached encrypted media renders without waiting for circle keys: a session
 * memo seeds the state synchronously on remount, and a disk peek resolves
 * cached files before the key gate. Only fresh decrypts wait for keys.
 *
 * `circleId` is required to resolve encrypted assets; asset records do not
 * carry it, so the rendering screen threads it in from its own context.
 */
export function useAssetMediaUri(
  asset: AssetMediaRef | null | undefined,
  variant: AssetMediaVariant = 'preview',
  circleId?: string | null,
): string | null {
  const getReadUrl = useAction(api.assets.getReadUrl);
  const isEncrypted = Boolean(asset?.encryption);
  const keys = useCircleKeys(isEncrypted ? circleId ?? null : null);
  const [uri, setUri] = useState<string | null>(() =>
    asset?.encryption && circleId ? peekMemoizedDecryptedUri(circleId, asset, variant) : null,
  );

  const assetId = asset?._id ?? null;
  // Effects key off stable primitives: record objects are recreated on every
  // reactive query update, but these values only change with real changes.
  const wrappedFileKey = asset?.encryption?.wrappedFileKey ?? null;
  const keysStateKey = keys.status === 'ready' ? `ready:${keys.epoch}` : keys.status;

  useEffect(() => {
    let isCancelled = false;
    let closeStream: (() => void) | null = null;

    const encryption = asset?.encryption;
    const memoized =
      encryption && circleId && asset
        ? peekMemoizedDecryptedUri(circleId, asset, variant)
        : null;

    // Session-memoized cache hits render immediately instead of flashing the
    // placeholder; the disk peek below re-verifies the file still exists.
    setUri(memoized);

    if (!assetId || !asset) {
      return;
    }

    const resolveWithKeys = () => {
      if (encryption && keys.status !== 'ready') {
        // 'loading' or 'waiting-for-grant': stay null until keys arrive.
        return;
      }

      if (
        encryption &&
        circleId &&
        asset.kind === 'video' &&
        variant === 'original' &&
        keys.status === 'ready'
      ) {
        // Encrypted video originals stream through the local range-decrypting
        // proxy (ciphertext straight from R2) instead of download-then-decrypt.
        void openEncryptedVideoStream({
          circleId,
          asset: { ...asset, encryption },
          keysByEpoch: keys.keysByEpoch,
          getSignedUrl: () => getReadUrl({ assetId, variant: 'original' }),
        })
          .then((stream) => {
            if (isCancelled) {
              stream.close();
              return;
            }

            closeStream = stream.close;
            setUri(stream.uri);
          })
          .catch(() => {
            if (!isCancelled) {
              setUri(null);
            }
          });

        return;
      }

      void resolveAssetMediaUri({
        asset,
        variant,
        circleId,
        getSignedUrl: async () => {
          const result = await getReadUrl({ assetId, variant });

          return result.url ?? null;
        },
        ...(keys.status === 'ready' ? { keysByEpoch: keys.keysByEpoch } : {}),
      })
        .then((resolved) => {
          if (!isCancelled) {
            setUri(resolved);
          }
        })
        .catch((error: unknown) => {
          // Callers render placeholders for null, so a failed resolution is
          // otherwise invisible; keep a trace for diagnosis.
          logger.warn('Asset media URI resolution failed.', { assetId, variant, error });

          if (!isCancelled) {
            setUri(null);
          }
        });
    };

    if (encryption && circleId) {
      // A fully decrypted file on disk renders without keys or network — this
      // covers app start before crypto unlock and every remount.
      void peekDecryptedAssetUri(circleId, asset, variant).then((cached) => {
        if (isCancelled) {
          return;
        }

        if (cached) {
          setUri(cached);
          return;
        }

        if (memoized) {
          // Memo was stale (OS purged the file); fall back to the placeholder
          // until the fresh resolution below finishes.
          setUri(null);
        }

        resolveWithKeys();
      });
    } else {
      resolveWithKeys();
    }

    return () => {
      isCancelled = true;
      closeStream?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, variant, circleId, wrappedFileKey, keysStateKey, getReadUrl]);

  return uri;
}
