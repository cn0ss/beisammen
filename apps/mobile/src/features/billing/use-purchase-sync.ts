import { useAction } from 'convex/react';
import { useCallback, useEffect, useRef } from 'react';

import type { CircleCreationReadiness, PurchaseSyncResult } from '@beisammen/contracts';

import { hasActiveStoreEntitlement } from '@/features/billing/purchases';
import { api } from '@/features/convex/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('billing.sync');

/**
 * Asks the backend to pull the current RevenueCat subscriber state on demand.
 * Webhooks remain the primary path; this closes the gap right after a purchase
 * or restore so plan-gated features unlock without waiting on delivery (or at
 * all, should the webhook be misconfigured). Best-effort: older self-hosted
 * instances without the action resolve to `null`.
 */
export function useSyncPurchases(): () => Promise<PurchaseSyncResult | null> {
  const syncPurchases = useAction(api.billing.syncPurchases);

  return useCallback(async () => {
    try {
      const result = await syncPurchases({});
      logger.info('Purchase sync finished', {
        status: result.status,
        activePlanId: result.activePlanId,
      });
      return result;
    } catch (error) {
      logger.warn('Purchase sync failed', { error });
      return null;
    }
  }, [syncPurchases]);
}

/**
 * Reconciles a stale backend plan state with the store: when Convex still
 * reports `plan_required` but RevenueCat holds an active entitlement for this
 * device (purchase made before the webhook arrived, restored on another
 * install, …), trigger one on-demand sync.
 */
export function useEntitlementReconciliation(
  readiness: CircleCreationReadiness | null | undefined,
): void {
  const sync = useSyncPurchases();
  const hasAttempted = useRef(false);

  useEffect(() => {
    if (hasAttempted.current || readiness?.reason !== 'plan_required') {
      return;
    }

    hasAttempted.current = true;

    void (async () => {
      if (await hasActiveStoreEntitlement()) {
        await sync();
      }
    })();
  }, [readiness?.reason, sync]);
}
