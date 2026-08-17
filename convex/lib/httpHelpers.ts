import { buildClerkInstanceConfig } from '@beisammen/contracts';

import {
  readCloudBillingPlansFromEnv,
  readDeploymentKindFromEnv,
} from './instance';

type EnvSource = Record<string, string | undefined>;

export function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function readOptionalEnv(name: string, env: EnvSource = process.env): string | null {
  const value = env[name];

  if (!value || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

export function readBaseUrl(env: EnvSource = process.env): string {
  const configured =
    env.PUBLIC_INSTANCE_BASE_URL ??
    env.INSTANCE_BASE_URL ??
    env.CONVEX_SITE_URL ??
    env.CONVEX_SITE_ORIGIN ??
    'http://127.0.0.1:3211';

  return trimTrailingSlashes(configured);
}

export function readConvexUrl(env: EnvSource = process.env): string {
  const configured =
    readOptionalEnv('PUBLIC_CONVEX_URL', env) ??
    readOptionalEnv('CONVEX_CLOUD_URL', env) ??
    readOptionalEnv('CONVEX_CLOUD_ORIGIN', env) ??
    'http://127.0.0.1:3210';

  return trimTrailingSlashes(configured);
}

export function readPublicAuthPublishableKey(env: EnvSource = process.env): string {
  const configured =
    readOptionalEnv('PUBLIC_AUTH_PUBLISHABLE_KEY', env) ??
    readOptionalEnv('CLERK_PUBLISHABLE_KEY', env);

  if (!configured) {
    throw new Error(
      'PUBLIC_AUTH_PUBLISHABLE_KEY must be set so instance discovery can serve the Clerk publishable key.',
    );
  }

  return configured;
}

export function buildDefaultInstanceId(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'beisammen';
  }
}

export function buildPublicInstanceConfigFromEnv(env: EnvSource = process.env) {
  const baseUrl = readBaseUrl(env);
  const deploymentKind = readDeploymentKindFromEnv(env);

  return buildClerkInstanceConfig({
    id: readOptionalEnv('PUBLIC_INSTANCE_ID', env) ?? buildDefaultInstanceId(baseUrl),
    name:
      readOptionalEnv('PUBLIC_INSTANCE_NAME', env) ??
      readOptionalEnv('INSTANCE_NAME', env) ??
      'beisammen',
    baseUrl,
    convexUrl: readConvexUrl(env),
    authPublishableKey: readPublicAuthPublishableKey(env),
    deploymentKind,
    billingPlans: deploymentKind === 'cloud' ? readCloudBillingPlansFromEnv(env) : undefined,
    minimumAppVersion: readOptionalEnv('PUBLIC_MINIMUM_APP_VERSION', env) ?? '0.1.0',
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
