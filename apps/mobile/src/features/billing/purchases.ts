import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

import { resolveRevenueCatKey } from '@/features/billing/config';
import { appEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('billing.purchases');

let configured = false;

function resolveApiKey() {
  return resolveRevenueCatKey({
    appEnvironment: appEnv.appEnv,
    platform: Platform.OS,
    testApiKey: appEnv.revenueCatTestApiKey,
    iosApiKey: appEnv.revenueCatIosApiKey,
    androidApiKey: appEnv.revenueCatAndroidApiKey,
  });
}

export function isPurchasesAvailable(): boolean {
  return resolveApiKey() !== null;
}

/**
 * Configures the RevenueCat SDK once per app launch. Returns false when no
 * platform API key is configured (e.g. self-hosted builds without billing).
 */
export function configurePurchases(): boolean {
  if (configured) {
    return true;
  }

  const resolvedKey = resolveApiKey();

  if (!resolvedKey) {
    logger.warn('RevenueCat is unavailable for this build configuration', {
      appEnvironment: appEnv.appEnv,
      platform: Platform.OS,
    });
    return false;
  }

  Purchases.setLogLevel(
    appEnv.appEnv === 'development' ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO,
  );
  Purchases.configure({ apiKey: resolvedKey.apiKey });
  configured = true;

  logger.info('RevenueCat configured', {
    platform: Platform.OS,
    store: resolvedKey.store,
  });

  return true;
}

/**
 * Identifies the RevenueCat customer as the Convex user id so webhook events
 * sync to the right billing owner.
 */
export async function logInPurchases(convexUserId: string): Promise<void> {
  if (!configurePurchases()) {
    return;
  }

  try {
    const currentAppUserId = await Purchases.getAppUserID();

    if (currentAppUserId === convexUserId) {
      return;
    }

    await Purchases.logIn(convexUserId);
  } catch (error) {
    logger.warn('Failed to identify RevenueCat customer', { error });
  }
}

export async function logOutPurchases(): Promise<void> {
  if (!configured) {
    return;
  }

  try {
    if (await Purchases.isAnonymous()) {
      return;
    }

    await Purchases.logOut();
  } catch (error) {
    // logOut throws when the current customer is already anonymous.
    logger.debug('Skipping RevenueCat logout', { error });
  }
}
