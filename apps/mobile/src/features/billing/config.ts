export type RevenueCatPlatform = 'ios' | 'android' | 'web' | 'macos' | 'windows';

export interface RevenueCatKeyConfig {
  appEnvironment: string;
  platform: RevenueCatPlatform;
  testApiKey: string;
  iosApiKey: string;
  androidApiKey: string;
}

export interface ResolvedRevenueCatKey {
  apiKey: string;
  store: 'test' | 'app-store' | 'play-store';
}

function normalizedKey(value: string): string {
  return value.trim();
}

/**
 * Development builds use RevenueCat's synthetic Test Store on both platforms.
 * Preview and production builds only accept the matching real store key, which
 * prevents a test key from accidentally reaching App Review or Google Play.
 */
export function resolveRevenueCatKey(
  config: RevenueCatKeyConfig,
): ResolvedRevenueCatKey | null {
  if (config.platform !== 'ios' && config.platform !== 'android') {
    return null;
  }

  if (config.appEnvironment === 'development') {
    const testApiKey = normalizedKey(config.testApiKey);

    return testApiKey.startsWith('test_')
      ? { apiKey: testApiKey, store: 'test' }
      : null;
  }

  const storeApiKey = normalizedKey(
    config.platform === 'ios' ? config.iosApiKey : config.androidApiKey,
  );
  const expectedPrefix = config.platform === 'ios' ? 'appl_' : 'goog_';

  if (!storeApiKey.startsWith(expectedPrefix)) {
    return null;
  }

  return {
    apiKey: storeApiKey,
    store: config.platform === 'ios' ? 'app-store' : 'play-store',
  };
}

// Plan presentation and purchases are owned by the RevenueCat paywall
// (RevenueCatUI.presentPaywall); the offering's package identifiers follow
// `$rc_custom_<planId>` / `$rc_custom_<planId>_yearly` in the dashboard.
