import {
  assertAppVersionSupported,
  assertInstanceBaseUrlMatches,
  parseInstanceConfig,
} from '../packages/contracts/src/index.ts';

export const DISCOVERY_PATH = '/.well-known/beisammen-instance.json';
export const timeoutMs = 10_000;

export function usage() {
  return [
    'Usage: pnpm smoke:beta -- <instance-url> [--expect-kind=cloud|self-hosted] [--app-version=<version>]',
    '',
    'Validates /healthz and /.well-known/beisammen-instance.json for a beta deployment.',
  ].join('\n');
}

export function normalizeBaseUrl(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty URL.`);
  }

  const url = new URL(value.trim());

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${fieldName} must use http or https.`);
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function requireRecord(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value;
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function requireBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value;
}

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return valid JSON.`);
  }
}

export function parseArgs(argv) {
  const args = {
    instanceUrl: null,
    expectKind: null,
    appVersion: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--expect-kind=')) {
      args.expectKind = arg.slice('--expect-kind='.length);
      continue;
    }

    if (arg.startsWith('--app-version=')) {
      const appVersion = arg.slice('--app-version='.length).trim();

      if (appVersion.length === 0) {
        throw new Error('--app-version must be a non-empty version.');
      }

      args.appVersion = appVersion;
      continue;
    }

    if (!args.instanceUrl) {
      args.instanceUrl = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!args.instanceUrl) {
    throw new Error('Missing instance URL.');
  }

  if (
    args.expectKind !== null &&
    args.expectKind !== 'cloud' &&
    args.expectKind !== 'self-hosted'
  ) {
    throw new Error('--expect-kind must be cloud or self-hosted.');
  }

  return args;
}

export function validateHealthz(payload) {
  const record = requireRecord(payload, 'healthz');

  if (record.ok !== true) {
    throw new Error('healthz.ok must be true.');
  }

  requireString(record.service, 'healthz.service');
}

function validateBilling(manifest, deploymentKind) {
  const billing = requireRecord(manifest.billing, 'billing');
  const enabled = requireBoolean(billing.enabled, 'billing.enabled');

  if (deploymentKind === 'cloud') {
    if (!enabled || billing.provider !== 'revenuecat') {
      throw new Error('cloud deployments must advertise RevenueCat billing.');
    }

    const plans = requireArray(billing.plans, 'billing.plans');

    if (plans.length === 0) {
      throw new Error('cloud deployments must advertise at least one paid billing plan.');
    }

    for (const [index, plan] of plans.entries()) {
      const planRecord = requireRecord(plan, `billing.plans[${index}]`);
      const label = `${planRecord.id ?? ''} ${planRecord.name ?? ''} ${planRecord.monthlyPriceLabel ?? ''}`;

      requireString(planRecord.id, `billing.plans[${index}].id`);
      requireString(planRecord.name, `billing.plans[${index}].name`);

      if (label.toLowerCase().includes('free')) {
        throw new Error('cloud billing plans must not advertise a free storage-generating tier.');
      }
    }

    return;
  }

  if (enabled) {
    throw new Error('self-hosted deployments must advertise billing.enabled=false.');
  }
}

export function validateManifest(payload, inputBaseUrl, expectKind, appVersion = null) {
  const manifest = requireRecord(payload, 'instance discovery manifest');
  const parsed = parseInstanceConfig(manifest);
  assertInstanceBaseUrlMatches(parsed, inputBaseUrl);
  const instance = requireRecord(manifest.instance, 'instance');
  const backend = requireRecord(manifest.backend, 'backend');
  const auth = requireRecord(manifest.auth, 'auth');
  const features = requireRecord(manifest.features, 'features');
  const deployment = requireRecord(manifest.deployment, 'deployment');
  const client = requireRecord(manifest.client, 'client');
  requireString(instance.baseUrl, 'instance.baseUrl');
  const convexUrl = normalizeBaseUrl(
    requireString(backend.convexUrl, 'backend.convexUrl'),
    'backend.convexUrl',
  );
  const deploymentKind = requireString(deployment.kind, 'deployment.kind');

  requireString(instance.id, 'instance.id');
  requireString(instance.name, 'instance.name');
  const minimumAppVersion = requireString(
    client.minimumAppVersion,
    'client.minimumAppVersion',
  );

  if (appVersion) {
    assertAppVersionSupported(appVersion, minimumAppVersion);
  }

  if (convexUrl.includes('.site')) {
    throw new Error('backend.convexUrl should be the Convex client URL, not the site URL.');
  }

  if (deploymentKind !== 'cloud' && deploymentKind !== 'self-hosted') {
    throw new Error('deployment.kind must be cloud or self-hosted.');
  }

  if (expectKind && deploymentKind !== expectKind) {
    throw new Error(`deployment.kind is ${deploymentKind}, expected ${expectKind}.`);
  }

  if (auth.provider !== 'clerk') {
    throw new Error('auth.provider must be clerk.');
  }

  if (auth.mode !== 'native') {
    throw new Error('auth.mode must be native.');
  }

  requireArray(auth.capabilities, 'auth.capabilities');
  const publicConfig = requireRecord(auth.publicConfig, 'auth.publicConfig');
  const publishableKey = requireString(
    publicConfig.publishableKey,
    'auth.publicConfig.publishableKey',
  );

  if (!publishableKey.startsWith('pk_')) {
    throw new Error('auth.publicConfig.publishableKey must be a Clerk publishable key.');
  }

  const storageProviders = requireArray(features.storageProviders, 'features.storageProviders');

  if (!storageProviders.includes('s3')) {
    throw new Error('features.storageProviders must include s3.');
  }

  const selfHosted = requireBoolean(features.selfHosted, 'features.selfHosted');

  if (selfHosted !== (deploymentKind === 'self-hosted')) {
    throw new Error('features.selfHosted must match deployment.kind.');
  }

  validateBilling(manifest, deploymentKind);

  return {
    instanceName: parsed.instance.name,
    deploymentKind: parsed.deployment.kind,
    authMode: parsed.auth.mode,
    minimumAppVersion: parsed.client.minimumAppVersion,
  };
}

export async function runSmokeCheck(input) {
  const baseUrl = normalizeBaseUrl(input.instanceUrl, 'instance URL');
  const healthz = await fetchJson(`${baseUrl}/healthz`);
  validateHealthz(healthz);

  const manifest = await fetchJson(`${baseUrl}${DISCOVERY_PATH}`);
  const summary = validateManifest(
    manifest,
    baseUrl,
    input.expectKind,
    input.appVersion,
  );

  return {
    baseUrl,
    discoveryPath: DISCOVERY_PATH,
    summary,
  };
}
