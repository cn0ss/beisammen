import {
  buildWorkOSInstanceConfig,
  type AuthMode,
  type BillingReturnSource,
} from '@beisammen/contracts';

import {
  readCloudBillingPlansFromEnv,
  readDeploymentKindFromEnv,
} from './instance';

type EnvSource = Record<string, string | undefined>;

export interface NormalizedWorkOSHttpSession {
  accessToken: string;
  refreshToken: string;
  subject: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string;
}

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

export function readPublicAuthMode(env: EnvSource = process.env): AuthMode {
  const configured = readOptionalEnv('PUBLIC_AUTH_MODE', env);

  if (configured === 'hosted-browser' || configured === 'native-client') {
    return configured;
  }

  return 'native-client';
}

export function readPublicAppScheme(env: EnvSource = process.env): string {
  const configured = readOptionalEnv('PUBLIC_APP_SCHEME', env) ?? 'beisammen';

  if (!/^[a-z][a-z0-9+.-]*$/i.test(configured)) {
    throw new Error('PUBLIC_APP_SCHEME must be a valid URL scheme.');
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

  return buildWorkOSInstanceConfig({
    id: readOptionalEnv('PUBLIC_INSTANCE_ID', env) ?? buildDefaultInstanceId(baseUrl),
    name:
      readOptionalEnv('PUBLIC_INSTANCE_NAME', env) ??
      readOptionalEnv('INSTANCE_NAME', env) ??
      'beisammen',
    baseUrl,
    convexUrl: readConvexUrl(env),
    authMode: readPublicAuthMode(env),
    authClientId:
      readOptionalEnv('PUBLIC_AUTH_CLIENT_ID', env) ??
      readOptionalEnv('WORKOS_CLIENT_ID', env) ??
      undefined,
    authSignInUrl: readOptionalEnv('PUBLIC_AUTH_SIGN_IN_URL', env) ?? undefined,
    deploymentKind,
    billingPlans: deploymentKind === 'cloud' ? readCloudBillingPlansFromEnv(env) : undefined,
    minimumAppVersion: readOptionalEnv('PUBLIC_MINIMUM_APP_VERSION', env) ?? '0.1.0',
  });
}

export function buildCallbackUrlFromEnv(env: EnvSource = process.env): string {
  return `${readBaseUrl(env)}/auth/callback`;
}

export function buildBillingReturnAppUrl(
  env: EnvSource = process.env,
  source: BillingReturnSource = 'checkout',
): string {
  const target = new URL(`${readPublicAppScheme(env)}://settings`);
  target.searchParams.set('billing', 'return');
  target.searchParams.set('source', source);
  return target.toString();
}

export function appendParamsToUrl(baseUrl: string, params: Record<string, string>): string {
  const target = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }

  return target.toString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getString(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return undefined;
}

export function getRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const candidate = value[key];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  return candidate as Record<string, unknown>;
}

export function normalizeWorkOSHttpSessionPayload(payload: unknown): NormalizedWorkOSHttpSession {
  const response = isRecord(payload) ? payload : {};
  const user = getRecord(response, 'user') ?? {};
  const firstName = getString(user, 'first_name', 'firstName') ?? '';
  const lastName = getString(user, 'last_name', 'lastName') ?? '';
  const email = getString(user, 'email') ?? '';
  const displayName =
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    getString(user, 'display_name', 'displayName') ||
    email;

  return {
    accessToken: getString(response, 'access_token', 'accessToken') ?? '',
    refreshToken: getString(response, 'refresh_token', 'refreshToken') ?? '',
    subject:
      getString(user, 'id') ??
      getString(response, 'user_id', 'userId', 'subject') ??
      '',
    email,
    firstName,
    lastName,
    displayName,
    avatarUrl: getString(user, 'profile_picture_url', 'profilePictureUrl') ?? '',
  };
}
