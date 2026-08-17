import { useEffect, useState } from 'react';

import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';
import type { AssetEncryptionEnvelope } from '@/features/crypto/asset-metadata';
import { useCircleKeys } from '@/features/crypto/use-circle-keys';

import { getDecryptedAssetUri } from './decrypted-cache';
import { openEncryptedVideoStream } from './video-proxy/playback';

/** Structural subset of an asset record the media hook needs to resolve a URI. */
export interface AssetMediaRef {
  _id: string;
  kind: 'image' | 'video';
  mimeType?: string;
  fileName?: string;
  encryption?: AssetEncryptionEnvelope | null;
}

export type AssetMediaVariant = 'preview' | 'original';

/**
 * Resolution core for images and previews, exported for tests. Plaintext
 * legacy assets resolve to their signed URL; encrypted assets resolve through
 * the decrypted cache to a local `file://` URI. Encrypted video originals do
 * not pass through here; they stream via the local range-decrypting proxy
 * (docs/e2ee.md, Phase 2).
 */
export async function resolveAssetMediaUri(input: {
  asset: AssetMediaRef;
  variant: AssetMediaVariant;
  getSignedUrl: () => Promise<string | null>;
  keysByEpoch?: Map<number, Uint8Array>;
}): Promise<string | null> {
  const { encryption } = input.asset;

  if (!encryption) {
    return await input.getSignedUrl();
  }

  if (!input.keysByEpoch) {
    return null;
  }

  return await getDecryptedAssetUri({
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
  const [uri, setUri] = useState<string | null>(null);

  const assetId = asset?._id ?? null;
  // Effects key off stable primitives: record objects are recreated on every
  // reactive query update, but these values only change with real changes.
  const wrappedFileKey = asset?.encryption?.wrappedFileKey ?? null;
  const keysStateKey = keys.status === 'ready' ? `ready:${keys.epoch}` : keys.status;

  useEffect(() => {
    let isCancelled = false;
    let closeStream: (() => void) | null = null;

    setUri(null);

    if (!assetId || !asset) {
      return;
    }

    if (isEncrypted && keys.status !== 'ready') {
      // 'loading' or 'waiting-for-grant': stay null until keys arrive.
      return;
    }

    const encryption = asset.encryption;

    if (
      encryption &&
      asset.kind === 'video' &&
      variant === 'original' &&
      keys.status === 'ready'
    ) {
      // Encrypted video originals stream through the local range-decrypting
      // proxy (ciphertext straight from R2) instead of download-then-decrypt.
      // A fully decrypted cache file is preferred when it already exists.
      void openEncryptedVideoStream({
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

      return () => {
        isCancelled = true;
        closeStream?.();
      };
    }

    void resolveAssetMediaUri({
      asset,
      variant,
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
      .catch(() => {
        if (!isCancelled) {
          setUri(null);
        }
      });

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, variant, wrappedFileKey, keysStateKey, getReadUrl]);

  return uri;
}
