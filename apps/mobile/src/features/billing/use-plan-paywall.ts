import { useCallback, useState } from 'react';
import { useGT } from 'gt-react-native';

import { presentPlanPaywall, type PlanPaywallOutcome } from '@/features/billing/paywall';

/**
 * Presents the plan paywall and reports the outcome as user-facing feedback.
 * Purchase and restore confirmations, unavailability, and load errors all go
 * through `onFeedback`; callers only branch on the returned outcome.
 */
export function usePlanPaywall(onFeedback: (message: string | null) => void) {
  const gt = useGT();
  const [isPresenting, setIsPresenting] = useState(false);

  const present = useCallback(async (): Promise<PlanPaywallOutcome> => {
    setIsPresenting(true);
    onFeedback(null);

    try {
      const { outcome, errorMessage } = await presentPlanPaywall();

      if (outcome === 'purchased' || outcome === 'restored') {
        onFeedback(gt('Kauf abgeschlossen. Dein Tarif ist aktiv.'));
      } else if (outcome === 'unavailable') {
        onFeedback(gt('In-App-Käufe sind in diesem Build nicht konfiguriert.'));
      } else if (outcome === 'error') {
        onFeedback(
          errorMessage ?? gt('Die Tarife konnten nicht geladen werden. Versuche es später erneut.'),
        );
      }

      return outcome;
    } finally {
      setIsPresenting(false);
    }
  }, [gt, onFeedback]);

  return { isPresenting, present };
}
