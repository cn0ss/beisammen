import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import { configurePurchases } from '@/features/billing/purchases';

export type PlanPaywallOutcome = 'purchased' | 'restored' | 'dismissed' | 'error' | 'unavailable';

export interface PlanPaywallResult {
  outcome: PlanPaywallOutcome;
  errorMessage: string | null;
}

/**
 * Presents the RevenueCat paywall configured on the current offering. The
 * paywall owns the whole purchase flow; entitlement changes reach Convex via
 * the RevenueCat webhook, so readiness queries update shortly after purchase.
 */
export async function presentPlanPaywall(): Promise<PlanPaywallResult> {
  if (!configurePurchases()) {
    return { outcome: 'unavailable', errorMessage: null };
  }

  try {
    const result = await RevenueCatUI.presentPaywall({ displayCloseButton: true });

    if (result === PAYWALL_RESULT.PURCHASED) {
      return { outcome: 'purchased', errorMessage: null };
    }

    if (result === PAYWALL_RESULT.RESTORED) {
      return { outcome: 'restored', errorMessage: null };
    }

    if (result === PAYWALL_RESULT.ERROR) {
      return { outcome: 'error', errorMessage: null };
    }

    return { outcome: 'dismissed', errorMessage: null };
  } catch (error) {
    return {
      outcome: 'error',
      errorMessage: error instanceof Error ? error.message : null,
    };
  }
}
