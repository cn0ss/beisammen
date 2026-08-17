import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { createLogger } from '@/lib/logger';

const logger = createLogger('appConfig.ota');
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Checks for OTA updates on launch and whenever the app returns to the
 * foreground (throttled). Downloaded updates apply on the next cold start;
 * the app-config gate additionally offers an immediate restart when an
 * update is pending and the running version is blocked.
 */
export function useOtaUpdates(): void {
  const lastCheckAt = useRef(0);

  useEffect(() => {
    // Disabled in dev clients and local builds without an update URL.
    if (!Updates.isEnabled) {
      return;
    }

    let cancelled = false;

    const check = async () => {
      const now = Date.now();

      if (now - lastCheckAt.current < CHECK_INTERVAL_MS) {
        return;
      }

      lastCheckAt.current = now;

      try {
        const result = await Updates.checkForUpdateAsync();

        if (cancelled || !result.isAvailable) {
          return;
        }

        await Updates.fetchUpdateAsync();
        logger.info('OTA update downloaded, applies on next launch');
      } catch (error) {
        logger.warn('OTA update check failed', { error });
      }
    };

    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void check();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}
