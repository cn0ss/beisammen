import * as SecureStore from 'expo-secure-store';

import type { AppSession } from '@beisammen/contracts';

import { createLogger } from '@/lib/logger';

const logger = createLogger('auth.store');
const STORAGE_KEY_PREFIX = 'beisammen.auth.';
const INVITE_STORAGE_KEY_PREFIX = 'beisammen.invite.';

export interface StoredAuthState {
  session: AppSession;
  accessToken: string;
  refreshToken?: string;
}

function buildStorageKey(instanceUrl: string): string {
  return `${STORAGE_KEY_PREFIX}${instanceUrl.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function buildInviteStorageKey(instanceUrl: string): string {
  return `${INVITE_STORAGE_KEY_PREFIX}${instanceUrl.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function isStoredAuthState(value: unknown): value is StoredAuthState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const session = candidate.session;

  return (
    typeof candidate.accessToken === 'string' &&
    (!('refreshToken' in candidate) || typeof candidate.refreshToken === 'string') &&
    !!session &&
    typeof session === 'object' &&
    !Array.isArray(session) &&
    typeof (session as Record<string, unknown>).instanceUrl === 'string' &&
    typeof (session as Record<string, unknown>).provider === 'string' &&
    typeof (session as Record<string, unknown>).subject === 'string' &&
    (!('expiresAt' in (session as Record<string, unknown>)) ||
      typeof (session as Record<string, unknown>).expiresAt === 'number')
  );
}

export async function loadStoredAuthState(
  instanceUrl: string,
): Promise<StoredAuthState | null> {
  const raw = await SecureStore.getItemAsync(buildStorageKey(instanceUrl));

  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isStoredAuthState(parsed)) {
      logger.warn('Discarding invalid stored auth state', { instanceUrl });
      await clearStoredAuthState(instanceUrl);
      return null;
    }

    return parsed;
  } catch (error) {
    logger.warn('Failed to parse stored auth state', {
      instanceUrl,
      error,
    });
    await clearStoredAuthState(instanceUrl);
    return null;
  }
}

export async function saveStoredAuthState(
  instanceUrl: string,
  state: StoredAuthState,
): Promise<void> {
  await SecureStore.setItemAsync(
    buildStorageKey(instanceUrl),
    JSON.stringify(state),
    {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    },
  );
}

export async function clearStoredAuthState(instanceUrl: string): Promise<void> {
  await SecureStore.deleteItemAsync(buildStorageKey(instanceUrl));
}

export async function loadStoredInviteToken(instanceUrl: string): Promise<string | null> {
  const token = await SecureStore.getItemAsync(buildInviteStorageKey(instanceUrl));

  if (!token || token.trim().length === 0) {
    return null;
  }

  return token.trim();
}

export async function saveStoredInviteToken(instanceUrl: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(buildInviteStorageKey(instanceUrl), token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function clearStoredInviteToken(instanceUrl: string): Promise<void> {
  await SecureStore.deleteItemAsync(buildInviteStorageKey(instanceUrl));
}
