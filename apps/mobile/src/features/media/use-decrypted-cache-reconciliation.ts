import { useEffect } from 'react';

import { useConvex, useConvexAuth } from 'convex/react';
import type { ConvexReactClient } from 'convex/react';

import type { CircleListItem, PaginatedResult } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { createLogger } from '@/lib/logger';

import { reconcileDecryptedMediaCache } from './decrypted-cache';

const logger = createLogger('media.cacheReconciliation');

const PAGE_SIZE = 100;
// Backstop against runaway pagination; nobody has 5000 circles, and an
// incomplete list must never be treated as authoritative.
const MAX_PAGES = 50;

let hasReconciled = false;

/** Test hook. */
export function resetDecryptedCacheReconciliationForTesting(): void {
  hasReconciled = false;
}

async function listAllCircleIds(convex: ConvexReactClient): Promise<string[] | null> {
  const circleIds: string[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result: PaginatedResult<CircleListItem> = await convex.query(api.circles.listForViewer, {
      paginationOpts: { numItems: PAGE_SIZE, cursor },
    });

    for (const circle of result.page) {
      circleIds.push(circle._id);
    }

    if (result.isDone) {
      return circleIds;
    }

    cursor = result.continueCursor;
  }

  return null;
}

/**
 * Once per app session (after sign-in), drops cached decrypted media of
 * circles the viewer no longer belongs to — the counterpart to
 * `clearCircleDecryptedMedia` on explicit leave, catching removals that
 * happened while the app was closed. Fails open: without a complete
 * membership list, nothing is deleted.
 */
export function useDecryptedCacheReconciliation(): void {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated || hasReconciled) {
      return;
    }

    hasReconciled = true;

    void (async () => {
      const circleIds = await listAllCircleIds(convex);

      if (circleIds === null) {
        return;
      }

      await reconcileDecryptedMediaCache(circleIds);
    })().catch((error) => {
      logger.warn('Failed to reconcile decrypted media cache.', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [convex, isAuthenticated]);
}
