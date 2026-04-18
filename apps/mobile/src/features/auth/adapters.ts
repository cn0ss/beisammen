import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';

import type {
  AppSession,
  AuthAdapter,
  AuthBeginSignInResult,
  AuthSessionResult,
  InstanceConfig,
} from '@beisammen/contracts';

import { createLogger } from '@/lib/logger';

const logger = createLogger('auth.adapter');
const WORKOS_USER_MANAGEMENT_URL = 'https://api.workos.com/user_management';

function buildNativeAuthenticateUrl(instance: InstanceConfig): string {
  return `${instance.instance.baseUrl}/auth/native/authenticate`;
}

function buildRefreshUrl(instance: InstanceConfig): string {
  return `${instance.instance.baseUrl}/auth/refresh`;
}

function readConfigString(instance: InstanceConfig, key: string): string | undefined {
  const value = instance.auth.publicConfig[key];
  return typeof value === 'string' ? value : undefined;
}

function buildDisplayName(user: {
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
}): string | undefined {
  if (user.displayName) {
    return user.displayName;
  }

  const joinedName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  if (joinedName) {
    return joinedName;
  }

  return user.email;
}

function buildSession(
  instance: InstanceConfig,
  input: {
    subject: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    expiresAt?: number;
  },
): AppSession {
  return {
    instanceUrl: instance.instance.baseUrl,
    provider: instance.auth.provider,
    subject: input.subject,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    expiresAt: input.expiresAt,
    capabilities: instance.auth.capabilities,
  };
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return globalThis.atob(`${normalized}${padding}`);
}

function readTokenExpiry(accessToken?: string): number | undefined {
  if (!accessToken) {
    return undefined;
  }

  try {
    const [, payload] = accessToken.split('.');

    if (!payload) {
      return undefined;
    }

    const decoded = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };

    if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
      return decoded.exp * 1000;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readTokenClaims(accessToken?: string): {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
} | null {
  if (!accessToken) {
    return null;
  }

  try {
    const [, payload] = accessToken.split('.');

    if (!payload) {
      return null;
    }

    const decoded = JSON.parse(decodeBase64Url(payload)) as {
      iss?: unknown;
      aud?: unknown;
      sub?: unknown;
      exp?: unknown;
    };

    return {
      iss: typeof decoded.iss === 'string' ? decoded.iss : undefined,
      aud:
        typeof decoded.aud === 'string' ||
        (Array.isArray(decoded.aud) && decoded.aud.every((value) => typeof value === 'string'))
          ? (decoded.aud as string | string[])
          : undefined,
      sub: typeof decoded.sub === 'string' ? decoded.sub : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    };
  } catch {
    return null;
  }
}

function readCallbackValue(
  queryParams: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = queryParams[key];
  return typeof value === 'string' ? value : undefined;
}

function toBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createCodeVerifier(): Promise<string> {
  return `${Crypto.randomUUID().replace(/-/g, '')}${Crypto.randomUUID().replace(/-/g, '')}`;
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    {
      encoding: Crypto.CryptoEncoding.BASE64,
    },
  );

  return toBase64Url(digest);
}

function requireWorkOSClientId(instance: InstanceConfig): string {
  const clientId = readConfigString(instance, 'clientId');

  if (clientId) {
    return clientId;
  }

  throw new Error(
    'Missing WorkOS clientId in public mobile config. Set EXPO_PUBLIC_DEFAULT_AUTH_CLIENT_ID.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return undefined;
}

function getRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const candidate = value[key];

  if (!isRecord(candidate)) {
    return null;
  }

  return candidate;
}

async function exchangeViaBackend(
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const rawPayload = await response.text();
  let payload: unknown = null;

  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (isRecord(payload)) {
      const message =
        getString(payload, 'message', 'error_description', 'error') ??
        `Auth request failed with status ${response.status}.`;

      throw new Error(message);
    }

    throw new Error(rawPayload || `Auth request failed with status ${response.status}.`);
  }

  if (!isRecord(payload)) {
    throw new Error('Unexpected auth response.');
  }

  return payload;
}

function buildWorkOSSessionResult(
  instance: InstanceConfig,
  payload: Record<string, unknown>,
): AuthSessionResult {
  const accessToken = getString(payload, 'access_token', 'accessToken');
  const user = getRecord(payload, 'user');
  const subject =
    getString(user ?? {}, 'id') ??
    getString(payload, 'user_id', 'userId', 'subject');

  if (!subject) {
    throw new Error('WorkOS response did not include a user id.');
  }

  const email =
    getString(user ?? {}, 'email') ??
    getString(payload, 'email');
  const displayName = buildDisplayName({
    email,
    displayName:
      getString(user ?? {}, 'display_name', 'displayName') ??
      getString(payload, 'display_name', 'displayName'),
    firstName:
      getString(user ?? {}, 'first_name', 'firstName') ??
      getString(payload, 'first_name', 'firstName'),
    lastName:
      getString(user ?? {}, 'last_name', 'lastName') ??
      getString(payload, 'last_name', 'lastName'),
  });

  const tokenClaims = readTokenClaims(accessToken);
  logger.info('Parsed WorkOS token claims', {
    baseUrl: instance.instance.baseUrl,
    issuer: tokenClaims?.iss,
    audience: tokenClaims?.aud,
    subject: tokenClaims?.sub,
    expiresAt: tokenClaims?.exp,
    hasAudience: Boolean(
      typeof tokenClaims?.aud === 'string'
        ? tokenClaims.aud
        : tokenClaims?.aud?.length,
    ),
  });

  return {
    session: buildSession(instance, {
      subject,
      email,
      displayName,
      avatarUrl:
        getString(user ?? {}, 'profile_picture_url', 'profilePictureUrl') ??
        getString(payload, 'avatar_url', 'avatarUrl'),
      expiresAt: readTokenExpiry(accessToken),
    }),
    accessToken,
    refreshToken: getString(payload, 'refresh_token', 'refreshToken'),
  };
}

class WorkOSAdapter implements AuthAdapter {
  private pendingState: string | null = null;
  private pendingCodeVerifier: string | null = null;

  async beginSignIn(input: {
    instance: InstanceConfig;
    redirectUrl: string;
  }): Promise<AuthBeginSignInResult> {
    logger.debug('Preparing WorkOS sign-in', {
      baseUrl: input.instance.instance.baseUrl,
      redirectUrl: input.redirectUrl,
      authMode: input.instance.auth.mode,
    });

    if (input.instance.auth.mode === 'native-client') {
      const clientId = requireWorkOSClientId(input.instance);
      const state = Crypto.randomUUID();
      const codeVerifier = await createCodeVerifier();
      const codeChallenge = await createCodeChallenge(codeVerifier);
      const authorizeUrl = new URL(`${WORKOS_USER_MANAGEMENT_URL}/authorize`);

      authorizeUrl.searchParams.set('provider', 'authkit');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', input.redirectUrl);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('screen_hint', 'sign-in');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      this.pendingState = state;
      this.pendingCodeVerifier = codeVerifier;

      return {
        type: 'open-browser',
        authUrl: authorizeUrl.toString(),
      };
    }

    const signInUrl = readConfigString(input.instance, 'signInUrl');

    if (!signInUrl) {
      throw new Error('Missing WorkOS signInUrl for hosted-browser mode.');
    }

    const state = Crypto.randomUUID();
    const authUrl = new URL(signInUrl);
    authUrl.searchParams.set('app_redirect_uri', input.redirectUrl);
    authUrl.searchParams.set('state', state);

    this.pendingState = state;
    this.pendingCodeVerifier = null;

    return {
      type: 'open-browser',
      authUrl: authUrl.toString(),
    };
  }

  async handleCallback(input: {
    instance: InstanceConfig;
    callbackUrl: string;
    currentSession: AppSession | null;
  }): Promise<AuthSessionResult | null> {
    const parsed = Linking.parse(input.callbackUrl);
    const queryParams = parsed.queryParams ?? {};
    const error = readCallbackValue(queryParams, 'error');
    const errorDescription = readCallbackValue(queryParams, 'error_description');

    if (error) {
      logger.error('WorkOS callback returned an error', {
        baseUrl: input.instance.instance.baseUrl,
        callbackUrl: input.callbackUrl,
        error,
        errorDescription,
      });
      throw new Error(errorDescription ?? error);
    }

    if (input.instance.auth.mode !== 'native-client') {
      const accessToken = readCallbackValue(queryParams, 'access_token');
      const refreshToken = readCallbackValue(queryParams, 'refresh_token');
      const subject =
        readCallbackValue(queryParams, 'user_id') ??
        readCallbackValue(queryParams, 'subject');

      if (!accessToken || !subject) {
        return input.currentSession ? { session: input.currentSession } : null;
      }

      const email = readCallbackValue(queryParams, 'email');
      const displayName = buildDisplayName({
        email,
        displayName: readCallbackValue(queryParams, 'display_name'),
        firstName: readCallbackValue(queryParams, 'first_name'),
        lastName: readCallbackValue(queryParams, 'last_name'),
      });
      const avatarUrl = readCallbackValue(queryParams, 'avatar_url');

      return {
        session: buildSession(input.instance, {
          subject,
          email,
          displayName,
          avatarUrl,
          expiresAt: readTokenExpiry(accessToken),
        }),
        accessToken,
        refreshToken,
      };
    }

    const code = readCallbackValue(queryParams, 'code');
    const state = readCallbackValue(queryParams, 'state');

    if (!code) {
      return input.currentSession ? { session: input.currentSession } : null;
    }

    if (this.pendingState && state !== this.pendingState) {
      throw new Error('Auth callback state did not match the pending request.');
    }

    if (!this.pendingCodeVerifier) {
      throw new Error('Missing pending PKCE code verifier.');
    }

    const payload = await exchangeViaBackend(buildNativeAuthenticateUrl(input.instance), {
      code,
      codeVerifier: this.pendingCodeVerifier,
    });

    const next = buildWorkOSSessionResult(input.instance, payload);

    logger.info('Received WorkOS native callback result', {
      baseUrl: input.instance.instance.baseUrl,
      hasRefreshToken: Boolean(next.refreshToken),
      subject: next.session.subject,
    });

    this.pendingState = null;
    this.pendingCodeVerifier = null;

    return next;
  }

  async refreshSession(input: {
    instance: InstanceConfig;
    currentSession: AppSession | null;
    refreshToken: string;
  }): Promise<AuthSessionResult | null> {
    const payload = await exchangeViaBackend(buildRefreshUrl(input.instance), {
      refreshToken: input.refreshToken,
    });

    const next = buildWorkOSSessionResult(input.instance, payload);

    if (!next.refreshToken) {
      next.refreshToken = input.refreshToken;
    }

    return next;
  }

  async restoreSession(input: {
    instance: InstanceConfig;
    currentSession: AppSession | null;
  }): Promise<AppSession | null> {
    logger.debug('Restoring local WorkOS session', {
      baseUrl: input.instance.instance.baseUrl,
      hasSession: Boolean(input.currentSession),
    });

    return this.getCurrentSession({ currentSession: input.currentSession });
  }

  async signOut(): Promise<void> {
    this.pendingState = null;
    this.pendingCodeVerifier = null;
  }

  getCurrentSession(input: {
    currentSession: AppSession | null;
  }): AppSession | null {
    return input.currentSession;
  }
}

export function createAuthAdapter(instance: InstanceConfig): AuthAdapter {
  void instance;
  return new WorkOSAdapter();
}
