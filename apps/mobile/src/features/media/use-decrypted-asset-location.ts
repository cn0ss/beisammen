import { useEffect, useState } from 'react';

import type { MediaLocation } from '@beisammen/contracts';
import type { SodiumApi } from '@beisammen/crypto';

import {
  openAssetMetadata,
  unwrapAssetFileKey,
  type AssetEncryptionEnvelope,
  type EncryptedAssetMetadata,
} from '@/features/crypto/asset-metadata';
import { getSodium } from '@/features/crypto/sodium';
import { useCircleKeys } from '@/features/crypto/use-circle-keys';

/**
 * Decrypted `encMetadata` per asset id, kept for the app session so lists can
 * rerender without re-deriving the file key. `null` marks a failed decrypt so
 * it is not retried on every render.
 */
const metadataByAssetId = new Map<string, EncryptedAssetMetadata | null>();

/** Test hook. */
export function resetDecryptedAssetMetadataForTesting(): void {
  metadataByAssetId.clear();
}

/** Pure core, exported for tests; memoizes per asset id. */
export function decryptAssetMetadata(input: {
  sodium: SodiumApi;
  assetId: string;
  envelope: AssetEncryptionEnvelope;
  keysByEpoch: Map<number, Uint8Array>;
}): EncryptedAssetMetadata | null {
  const cached = metadataByAssetId.get(input.assetId);

  if (cached !== undefined) {
    return cached;
  }

  if (!input.envelope.encMetadata) {
    metadataByAssetId.set(input.assetId, null);
    return null;
  }

  let metadata: EncryptedAssetMetadata | null = null;

  try {
    const fileKey = unwrapAssetFileKey({
      sodium: input.sodium,
      envelope: input.envelope,
      keysByEpoch: input.keysByEpoch,
    });

    metadata = openAssetMetadata({
      sodium: input.sodium,
      fileKey,
      encMetadata: input.envelope.encMetadata,
    });
  } catch {
    metadata = null;
  }

  metadataByAssetId.set(input.assetId, metadata);

  return metadata;
}

/**
 * Location of an encrypted asset, recovered from its sealed metadata once the
 * circle keys are available. Plaintext legacy assets carry `location` on the
 * record itself and should not need this hook; it returns null for them.
 */
export function useDecryptedAssetLocation(input: {
  assetId: string | null | undefined;
  encryption?: AssetEncryptionEnvelope | null;
  circleId?: string | null;
}): MediaLocation | null {
  const { assetId, encryption, circleId } = input;
  const hasSealedMetadata = Boolean(assetId && encryption?.encMetadata);
  const keys = useCircleKeys(hasSealedMetadata ? circleId ?? null : null);
  const [location, setLocation] = useState<MediaLocation | null>(() =>
    assetId ? metadataByAssetId.get(assetId)?.location ?? null : null,
  );

  const wrappedFileKey = encryption?.wrappedFileKey ?? null;
  const keysStateKey = keys.status === 'ready' ? `ready:${keys.epoch}` : keys.status;

  useEffect(() => {
    let isCancelled = false;

    if (!assetId || !encryption?.encMetadata) {
      setLocation(null);
      return;
    }

    const cached = metadataByAssetId.get(assetId);

    if (cached !== undefined) {
      setLocation(cached?.location ?? null);
      return;
    }

    if (keys.status !== 'ready') {
      setLocation(null);
      return;
    }

    const { keysByEpoch } = keys;

    void getSodium()
      .then((sodium) => {
        if (isCancelled) {
          return;
        }

        const metadata = decryptAssetMetadata({
          sodium,
          assetId,
          envelope: encryption,
          keysByEpoch,
        });

        setLocation(metadata?.location ?? null);
      })
      .catch(() => {
        if (!isCancelled) {
          setLocation(null);
        }
      });

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, wrappedFileKey, keysStateKey]);

  return location;
}
