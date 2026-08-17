import { describe, expect, test } from 'vitest';

import {
  parseArgs,
  validateHealthz,
  validateManifest,
} from './smoke-beta-lib.mjs';

const cloudManifest = {
  instance: {
    id: 'cloud',
    name: 'Cloud',
    baseUrl: 'https://cloud.example.com',
  },
  backend: {
    convexUrl: 'https://cloud.convex.cloud',
  },
  auth: {
    provider: 'clerk',
    mode: 'native',
    capabilities: ['password'],
    publicConfig: {
      publishableKey: 'pk_test_123',
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
    provider: 'revenuecat',
    plans: [
      {
        id: 'cloud_family',
        name: 'Family',
        monthlyPriceLabel: '$9/month',
      },
    ],
  },
  client: {
    minimumAppVersion: '0.1.0',
  },
};

function clone(value) {
  return structuredClone(value);
}

describe('beta smoke manifest validation', () => {
  test('validates cloud manifest summary', () => {
    expect(validateManifest(cloudManifest, 'https://cloud.example.com', 'cloud')).toEqual({
      instanceName: 'Cloud',
      deploymentKind: 'cloud',
      authMode: 'native',
      minimumAppVersion: '0.1.0',
    });
  });

  test('validates self-hosted manifest with billing disabled', () => {
    const manifest = clone(cloudManifest);
    manifest.instance.id = 'self-hosted';
    manifest.instance.name = 'Self-hosted';
    manifest.instance.baseUrl = 'https://home.example.com';
    manifest.features.selfHosted = true;
    manifest.deployment.kind = 'self-hosted';
    manifest.billing = {
      enabled: false,
    };

    expect(validateManifest(manifest, 'https://home.example.com', 'self-hosted')).toEqual({
      instanceName: 'Self-hosted',
      deploymentKind: 'self-hosted',
      authMode: 'native',
      minimumAppVersion: '0.1.0',
    });
  });

  test('rejects manifests that require a newer app version', () => {
    const manifest = clone(cloudManifest);
    manifest.client.minimumAppVersion = '0.2.0';

    expect(() =>
      validateManifest(manifest, 'https://cloud.example.com', 'cloud', '0.1.0'),
    ).toThrow(/requires app version 0\.2\.0/i);
  });

  test('rejects cloud manifests that advertise a free storage-generating plan', () => {
    const manifest = clone(cloudManifest);
    manifest.billing.plans[0].monthlyPriceLabel = 'Free beta plan';

    expect(() =>
      validateManifest(manifest, 'https://cloud.example.com', 'cloud'),
    ).toThrow(/free storage-generating/i);
  });

  test('rejects manifests whose base URL does not match the checked instance', () => {
    const manifest = clone(cloudManifest);
    manifest.instance.baseUrl = 'https://other.example.com';

    expect(() =>
      validateManifest(manifest, 'https://cloud.example.com', 'cloud'),
    ).toThrow(/does not match/i);
  });

  test('rejects health responses that are not healthy', () => {
    expect(() =>
      validateHealthz({
        ok: false,
        service: 'beisammen-convex',
      }),
    ).toThrow(/healthz\.ok/i);
  });
});

describe('beta smoke CLI args', () => {
  test('parses instance URL and expected deployment kind', () => {
    expect(parseArgs(['https://cloud.example.com', '--expect-kind=cloud'])).toEqual({
      instanceUrl: 'https://cloud.example.com',
      expectKind: 'cloud',
      appVersion: null,
    });
  });

  test('parses optional app version', () => {
    expect(
      parseArgs(['https://cloud.example.com', '--expect-kind=cloud', '--app-version=0.1.0']),
    ).toEqual({
      instanceUrl: 'https://cloud.example.com',
      expectKind: 'cloud',
      appVersion: '0.1.0',
    });
  });

  test('rejects invalid expected deployment kind', () => {
    expect(() =>
      parseArgs(['https://cloud.example.com', '--expect-kind=preview']),
    ).toThrow(/expect-kind/i);
  });
});
