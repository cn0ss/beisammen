import { useCallback, useEffect, useState } from 'react';

import { useConvex } from 'convex/react';
import type { ConvexReactClient } from 'convex/react';

import type { MediaLocation } from '@beisammen/contracts';
import type { SodiumApi } from '@beisammen/crypto';

import type { AssetMetadataRecord, CircleListItem, PaginatedResult } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { keysApi } from '@/features/crypto/api';
import type { AssetEncryptionEnvelope } from '@/features/crypto/asset-metadata';
import { ensureCircleKey } from '@/features/crypto/circle-keys';
import { useCrypto } from '@/features/crypto/provider';
import { getSodium } from '@/features/crypto/sodium';
import type { UnlockedUserKeys } from '@/features/crypto/user-keys';
import { formatMediaLocation } from '@/features/media/client';
import { decryptAssetMetadata } from '@/features/media/use-decrypted-asset-location';

/**
 * A memory with coordinates for the map, aggregated on the client from
 * `assets.listMetadataForCircle`: legacy assets contribute their plaintext
 * `location`, encrypted assets contribute the location recovered from their
 * sealed metadata. Carries the encryption envelope so markers and sheet tiles
 * can resolve real preview thumbnails via `useAssetMediaUri`.
 */
export interface LocatedMemoryItem {
  /** The asset id — unique across circles, used as list/marker key. */
  _id: string;
  assetId: string;
  circleId: string;
  circleName: string;
  kind: 'image' | 'video';
  timelineAt: number;
  capturedAt: number | null;
  latitude: number;
  longitude: number;
  placeLabel: string | null;
  location: MediaLocation;
  asset: {
    mimeType?: string;
    fileName?: string;
    encryption?: AssetEncryptionEnvelope;
  };
}

export type LocatedMemoryItemsState = {
  status: 'loading' | 'ready';
  items: LocatedMemoryItem[];
  refresh: () => void;
};

/** Mirrors MEMORY_MAP_ITEMS_PER_CIRCLE_LIMIT in convex/memories.ts. */
export const LOCATED_ASSETS_PER_CIRCLE_LIMIT = 250;
/** Mirrors MEMORY_MAP_TOTAL_LIMIT in convex/memories.ts. */
export const LOCATED_ITEMS_TOTAL_LIMIT = 750;
/** Mirrors MEMORY_MEMBERSHIP_LIMIT in convex/memories.ts. */
const CIRCLE_LIST_LIMIT = 100;
const CIRCLE_LIST_PAGE_SIZE = 40;
const METADATA_PAGE_SIZE = 100;

/**
 * Pure per-circle aggregation core, exported for tests. Considers at most
 * `LOCATED_ASSETS_PER_CIRCLE_LIMIT` most-recent assets (the caller pages in
 * descending order), keeps every asset whose plaintext or decrypted metadata
 * carries a location, and skips encrypted assets whose epoch key is missing
 * without poisoning the session decrypt cache.
 */
export function collectLocatedItemsForCircle(input: {
  sodium: SodiumApi;
  circle: { _id: string; name: string };
  assets: AssetMetadataRecord[];
  keysByEpoch: Map<number, Uint8Array> | null;
}): LocatedMemoryItem[] {
  const items: LocatedMemoryItem[] = [];

  for (const asset of input.assets.slice(0, LOCATED_ASSETS_PER_CIRCLE_LIMIT)) {
    let location = asset.location ?? null;
    let fileName: string | undefined;

    if (!location && asset.encryption?.encMetadata) {
      // Only decrypt when the epoch key is actually present — a failed attempt
      // would be cached as permanent and never retried once keys arrive.
      if (!input.keysByEpoch?.has(asset.encryption.circleEpoch)) {
        continue;
      }

      const metadata = decryptAssetMetadata({
        sodium: input.sodium,
        assetId: asset._id,
        envelope: asset.encryption,
        keysByEpoch: input.keysByEpoch,
      });

      location = metadata?.location ?? null;
      fileName = metadata?.fileName;
    }

    if (!location) {
      continue;
    }

    items.push({
      _id: asset._id,
      assetId: asset._id,
      circleId: input.circle._id,
      circleName: input.circle.name,
      kind: asset.kind,
      timelineAt: asset.capturedAt ?? asset.createdAt,
      capturedAt: asset.capturedAt ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      placeLabel: formatMediaLocation(location),
      location,
      asset: {
        ...(fileName ? { fileName } : {}),
        ...(asset.encryption ? { encryption: asset.encryption } : {}),
      },
    });
  }

  return items;
}

/** Newest-first merge across circles, capped like the server map query. */
export function mergeLocatedItems(groups: LocatedMemoryItem[][]): LocatedMemoryItem[] {
  return groups
    .flat()
    .sort((left, right) => right.timelineAt - left.timelineAt)
    .slice(0, LOCATED_ITEMS_TOTAL_LIMIT);
}

async function listTargetCircles(
  convex: ConvexReactClient,
  circleId: string | null,
): Promise<Array<{ _id: string; name: string }>> {
  if (circleId) {
    const circle = await convex.query(api.circles.getById, { circleId });

    return circle ? [{ _id: circle._id, name: circle.name }] : [];
  }

  const circles: Array<{ _id: string; name: string }> = [];
  let cursor: string | null = null;

  while (circles.length < CIRCLE_LIST_LIMIT) {
    const page: PaginatedResult<CircleListItem> = await convex.query(api.circles.listForViewer, {
      paginationOpts: { numItems: CIRCLE_LIST_PAGE_SIZE, cursor },
    });

    for (const circle of page.page) {
      circles.push({ _id: circle._id, name: circle.name });
    }

    if (page.isDone) {
      break;
    }

    cursor = page.continueCursor;
  }

  return circles.slice(0, CIRCLE_LIST_LIMIT);
}

async function pageCircleAssets(
  convex: ConvexReactClient,
  circleId: string,
): Promise<AssetMetadataRecord[]> {
  const assets: AssetMetadataRecord[] = [];
  let cursor: string | null = null;

  while (assets.length < LOCATED_ASSETS_PER_CIRCLE_LIMIT) {
    const page: PaginatedResult<AssetMetadataRecord> = await convex.query(
      api.assets.listMetadataForCircle,
      {
        circleId,
        paginationOpts: {
          numItems: Math.min(METADATA_PAGE_SIZE, LOCATED_ASSETS_PER_CIRCLE_LIMIT - assets.length),
          cursor,
        },
      },
    );

    assets.push(...page.page);

    if (page.isDone) {
      break;
    }

    cursor = page.continueCursor;
  }

  return assets.slice(0, LOCATED_ASSETS_PER_CIRCLE_LIMIT);
}

async function resolveCircleKeys(
  convex: ConvexReactClient,
  sodium: SodiumApi,
  userKeys: UnlockedUserKeys,
  circleId: string,
): Promise<Map<number, Uint8Array> | null> {
  try {
    const result = await ensureCircleKey({
      sodium,
      userKeys,
      getMyCircleKeys: () => convex.query(keysApi.getMyCircleKeys, { circleId }),
      initializeCircleKey: (sealedCircleKey) =>
        convex.mutation(keysApi.initializeCircleKey, { circleId, sealedCircleKey }),
    });

    return result.status === 'ready' ? result.keysByEpoch : null;
  } catch {
    // Keys not resolvable right now — the circle simply contributes no
    // encrypted markers yet; a refresh or remount retries.
    return null;
  }
}

/**
 * Client-built data source for the memories map: enumerates the viewer's
 * circles, pages `assets.listMetadataForCircle` per circle, and turns both
 * plaintext-legacy and decrypted-encrypted locations into map items. Items
 * appear progressively per circle; `status` flips to 'ready' once every
 * circle was processed.
 */
export function useLocatedMemoryItems(input: {
  circleId: string | null;
  enabled: boolean;
}): LocatedMemoryItemsState {
  const convex = useConvex();
  const crypto = useCrypto();
  const [refreshToken, setRefreshToken] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [items, setItems] = useState<LocatedMemoryItem[]>([]);

  const { circleId, enabled } = input;
  const userKeys = crypto.status === 'ready' ? crypto.userKeys : null;
  // Wait for the crypto bootstrap so encrypted assets are not silently skipped
  // on the very first pass; 'recovery-required'/'unavailable' proceed with
  // legacy items only.
  const cryptoSettled = crypto.status !== 'loading';

  useEffect(() => {
    if (!enabled || !cryptoSettled) {
      setStatus('loading');
      setItems([]);
      return;
    }

    let cancelled = false;

    setStatus('loading');
    setItems([]);

    void (async () => {
      const groups: LocatedMemoryItem[][] = [];

      try {
        const sodium = await getSodium();
        const circles = await listTargetCircles(convex, circleId);

        for (const circle of circles) {
          if (cancelled) {
            return;
          }

          const assets = await pageCircleAssets(convex, circle._id);
          const needsKeys = assets.some((asset) => asset.encryption?.encMetadata);
          const keysByEpoch =
            needsKeys && userKeys
              ? await resolveCircleKeys(convex, sodium, userKeys, circle._id)
              : null;

          if (cancelled) {
            return;
          }

          const circleItems = collectLocatedItemsForCircle({
            sodium,
            circle,
            assets,
            keysByEpoch,
          });

          if (circleItems.length > 0) {
            groups.push(circleItems);
            setItems(mergeLocatedItems(groups));
          }

          if (groups.reduce((total, group) => total + group.length, 0) >= LOCATED_ITEMS_TOTAL_LIMIT) {
            break;
          }
        }
      } catch {
        // Partial results stay visible; the pass just ends early.
      }

      if (!cancelled) {
        setItems(mergeLocatedItems(groups));
        setStatus('ready');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [circleId, convex, cryptoSettled, enabled, refreshToken, userKeys]);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  return { status, items, refresh };
}
