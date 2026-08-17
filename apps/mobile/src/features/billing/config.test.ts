import { describe, expect, test } from 'vitest';

import { resolveRevenueCatKey, type RevenueCatKeyConfig } from './config';

const baseConfig: RevenueCatKeyConfig = {
  appEnvironment: 'production',
  platform: 'ios',
  testApiKey: 'test_demo',
  iosApiKey: 'appl_demo',
  androidApiKey: 'goog_demo',
};

describe('RevenueCat build configuration', () => {
  test('uses the Test Store key for development on both native platforms', () => {
    expect(
      resolveRevenueCatKey({
        ...baseConfig,
        appEnvironment: 'development',
        platform: 'ios',
      }),
    ).toEqual({ apiKey: 'test_demo', store: 'test' });
    expect(
      resolveRevenueCatKey({
        ...baseConfig,
        appEnvironment: 'development',
        platform: 'android',
      }),
    ).toEqual({ apiKey: 'test_demo', store: 'test' });
  });

  test('uses only platform-matching store keys outside development', () => {
    expect(resolveRevenueCatKey(baseConfig)).toEqual({
      apiKey: 'appl_demo',
      store: 'app-store',
    });
    expect(
      resolveRevenueCatKey({ ...baseConfig, appEnvironment: 'preview', platform: 'android' }),
    ).toEqual({ apiKey: 'goog_demo', store: 'play-store' });
  });

  test('rejects missing, cross-platform, and Test Store keys in production', () => {
    expect(resolveRevenueCatKey({ ...baseConfig, iosApiKey: 'test_demo' })).toBeNull();
    expect(resolveRevenueCatKey({ ...baseConfig, iosApiKey: 'goog_demo' })).toBeNull();
    expect(resolveRevenueCatKey({ ...baseConfig, iosApiKey: '' })).toBeNull();
  });
});
