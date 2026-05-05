import { describe, expect, test } from 'vitest';

import {
  INSTANCE_DISCOVERY_PATH,
  assertInstanceBaseUrlMatches,
  assertAppVersionSupported,
  buildInstanceDiscoveryUrl,
  buildWorkOSInstanceConfig,
  compareAppVersions,
  isAppVersionSupported,
  parseInstanceConfig,
} from './index';

describe('instance discovery', () => {
  test('compares app versions using semantic numeric precedence', () => {
    expect(compareAppVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareAppVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareAppVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareAppVersions('1.0.0+5', '1.0.0')).toBe(0);
    expect(compareAppVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
  });

  test('checks whether an app version satisfies a minimum app version', () => {
    expect(isAppVersionSupported('0.1.0', '0.1.0')).toBe(true);
    expect(isAppVersionSupported('0.1.1', '0.1.0')).toBe(true);
    expect(isAppVersionSupported('0.0.9', '0.1.0')).toBe(false);
  });

  test('throws a useful error when the app version is below the manifest minimum', () => {
    expect(() => assertAppVersionSupported('0.0.9', '0.1.0')).toThrow(
      /requires app version 0\.1\.0 or newer/i,
    );
  });

  test('builds the well-known discovery URL from a base URL', () => {
    expect(buildInstanceDiscoveryUrl('https://family.example.com/')).toBe(
      `https://family.example.com${INSTANCE_DISCOVERY_PATH}`,
    );
  });

  test('accepts manifests whose base URL matches the requested instance URL', () => {
    const config = buildWorkOSInstanceConfig({
      id: 'family',
      name: 'Family',
      baseUrl: 'https://family.example.com/',
      convexUrl: 'https://family.convex.cloud/',
      authMode: 'native-client',
      authClientId: 'client_123',
      minimumAppVersion: '0.1.0',
    });

    expect(() =>
      assertInstanceBaseUrlMatches(config, 'https://family.example.com/'),
    ).not.toThrow();
  });

  test('rejects manifests whose base URL does not match the requested instance URL', () => {
    const config = buildWorkOSInstanceConfig({
      id: 'family',
      name: 'Family',
      baseUrl: 'https://other.example.com/',
      convexUrl: 'https://family.convex.cloud/',
      authMode: 'native-client',
      authClientId: 'client_123',
      minimumAppVersion: '0.1.0',
    });

    expect(() =>
      assertInstanceBaseUrlMatches(config, 'https://family.example.com/'),
    ).toThrow(/instance\.baseUrl.*does not match/i);
  });

  test('builds a public WorkOS instance config', () => {
    expect(
      buildWorkOSInstanceConfig({
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
        convexUrl: 'https://family.convex.cloud/',
        authMode: 'native-client',
        authClientId: 'client_123',
        minimumAppVersion: '0.1.0',
      }),
    ).toMatchObject({
      instance: {
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com',
      },
      backend: {
        convexUrl: 'https://family.convex.cloud',
      },
      auth: {
        provider: 'workos',
        mode: 'native-client',
        publicConfig: {
          clientId: 'client_123',
          redirectPath: 'auth/callback',
        },
      },
      features: {
        storageProviders: ['s3'],
        selfHosted: false,
      },
      deployment: {
        kind: 'cloud',
      },
      billing: {
        enabled: true,
        provider: 'autumn',
      },
      client: {
        minimumAppVersion: '0.1.0',
      },
    });
  });

  test('builds self-hosted public config with billing disabled', () => {
    expect(
      buildWorkOSInstanceConfig({
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
        convexUrl: 'https://family.convex.cloud/',
        authMode: 'native-client',
        authClientId: 'client_123',
        deploymentKind: 'self-hosted',
        minimumAppVersion: '0.1.0',
      }),
    ).toMatchObject({
      features: {
        selfHosted: true,
      },
      deployment: {
        kind: 'self-hosted',
      },
      billing: {
        enabled: false,
      },
    });
  });

  test('parses valid public instance config and rejects invalid values', () => {
    const parsed = parseInstanceConfig({
      instance: {
        id: 'family',
        name: 'Family',
        baseUrl: 'https://family.example.com/',
      },
      backend: {
        convexUrl: 'https://family.convex.cloud/',
      },
      auth: {
        provider: 'workos',
        mode: 'hosted-browser',
        capabilities: ['password', 'email_otp'],
        publicConfig: {
          redirectPath: 'auth/callback',
          signInUrl: 'https://family.example.com/auth/sign-in',
        },
      },
      features: {
        storageProviders: ['s3'],
        selfHosted: true,
      },
      deployment: {
        kind: 'self-hosted',
      },
      billing: {
        enabled: false,
      },
      client: {
        minimumAppVersion: '0.1.0',
      },
    });

    expect(parsed.instance.baseUrl).toBe('https://family.example.com');
    expect(parsed.backend.convexUrl).toBe('https://family.convex.cloud');

    expect(() =>
      parseInstanceConfig({
        ...parsed,
        features: {
          storageProviders: ['convex-files'],
          selfHosted: true,
        },
      }),
    ).toThrow(/storage provider/i);
  });

  test('rejects cloud config without Autumn billing', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.cloud',
        },
        auth: {
          provider: 'workos',
          mode: 'native-client',
          capabilities: ['password'],
          publicConfig: {
            clientId: 'client_123',
            redirectPath: 'auth/callback',
          },
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: false,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'stripe',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/Autumn billing/i);
  });

  test('rejects manifests whose self-hosted flag does not match deployment kind', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.cloud',
        },
        auth: {
          provider: 'workos',
          mode: 'native-client',
          capabilities: ['password'],
          publicConfig: {
            clientId: 'client_123',
            redirectPath: 'auth/callback',
          },
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: true,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'autumn',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/selfHosted.*deployment/i);
  });

  test('rejects manifests missing auth public config required by their auth mode', () => {
    const nativeClientManifest = {
      instance: {
        id: 'cloud',
        name: 'Cloud',
        baseUrl: 'https://cloud.example.com',
      },
      backend: {
        convexUrl: 'https://cloud.convex.cloud',
      },
      auth: {
        provider: 'workos',
        mode: 'native-client',
        capabilities: ['password'],
        publicConfig: {
          redirectPath: 'auth/callback',
        },
      },
      features: {
        storageProviders: ['s3'],
        selfHosted: false,
      },
      deployment: {
        kind: 'cloud',
      },
      billing: {
        enabled: true,
        provider: 'autumn',
      },
      client: {
        minimumAppVersion: '0.1.0',
      },
    };
    const hostedBrowserManifest = {
      ...nativeClientManifest,
      auth: {
        ...nativeClientManifest.auth,
        mode: 'hosted-browser',
        publicConfig: {
          redirectPath: 'auth/callback',
        },
      },
    };

    expect(() => parseInstanceConfig(nativeClientManifest)).toThrow(/clientId/i);
    expect(() => parseInstanceConfig(hostedBrowserManifest)).toThrow(/signInUrl/i);
  });

  test('rejects manifests that use a Convex site URL as the client URL', () => {
    expect(() =>
      parseInstanceConfig({
        instance: {
          id: 'cloud',
          name: 'Cloud',
          baseUrl: 'https://cloud.example.com',
        },
        backend: {
          convexUrl: 'https://cloud.convex.site',
        },
        auth: {
          provider: 'workos',
          mode: 'native-client',
          capabilities: ['password'],
          publicConfig: {
            clientId: 'client_123',
            redirectPath: 'auth/callback',
          },
        },
        features: {
          storageProviders: ['s3'],
          selfHosted: false,
        },
        deployment: {
          kind: 'cloud',
        },
        billing: {
          enabled: true,
          provider: 'autumn',
        },
        client: {
          minimumAppVersion: '0.1.0',
        },
      }),
    ).toThrow(/Convex client URL/i);
  });
});
