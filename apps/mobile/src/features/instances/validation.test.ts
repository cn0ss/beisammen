import { describe, expect, test } from 'vitest';

import { buildWorkOSInstanceConfig } from '@beisammen/contracts';

import {
  AppVersionUnsupportedError,
  parseDiscoveredInstanceConfig,
} from './validation';

const manifest = buildWorkOSInstanceConfig({
  id: 'home',
  name: 'Home',
  baseUrl: 'https://home.example.com',
  convexUrl: 'https://home.convex.cloud',
  authMode: 'hosted-browser',
  authSignInUrl: 'https://home.example.com/auth/sign-in',
  deploymentKind: 'self-hosted',
  minimumAppVersion: '0.1.0',
});

describe('instance discovery validation', () => {
  test('accepts a matching manifest for the current app version', () => {
    expect(
      parseDiscoveredInstanceConfig({
        payload: manifest,
        requestedBaseUrl: 'https://home.example.com/',
        currentAppVersion: '0.1.0',
      }),
    ).toMatchObject({
      instance: {
        baseUrl: 'https://home.example.com',
      },
      deployment: {
        kind: 'self-hosted',
      },
    });
  });

  test('rejects redirected or mismatched instance manifests', () => {
    expect(() =>
      parseDiscoveredInstanceConfig({
        payload: {
          ...manifest,
          instance: {
            ...manifest.instance,
            baseUrl: 'https://other.example.com',
          },
        },
        requestedBaseUrl: 'https://home.example.com',
        currentAppVersion: '0.1.0',
      }),
    ).toThrow(/does not match/i);
  });

  test('raises a typed error when the app is too old', () => {
    expect(() =>
      parseDiscoveredInstanceConfig({
        payload: {
          ...manifest,
          client: {
            minimumAppVersion: '0.2.0',
          },
        },
        requestedBaseUrl: 'https://home.example.com',
        currentAppVersion: '0.1.0',
      }),
    ).toThrow(AppVersionUnsupportedError);
  });
});
