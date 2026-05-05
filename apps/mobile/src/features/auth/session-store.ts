import * as SecureStore from 'expo-secure-store';

import type { AppSession, InstanceConfig } from '@beisammen/contracts';
import { parseInstanceConfig } from '@beisammen/contracts';

import { createLogger } from '@/lib/logger';
import { buildAuthStorageKey, buildInviteStorageKey } from './session-keys';

const logger = createLogger('auth.store');
const INSTANCE_STORAGE_KEY = 'beisammen.instance.active';

export interface StoredAuthState {
  session: AppSession;
  accessToken: string;
  refreshToken?: string;
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
  const raw = await SecureStore.getItemAsync(buildAuthStorageKey(instanceUrl));

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
    buildAuthStorageKey(instanceUrl),
    JSON.stringify(state),
    {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    },
  );
}

export async function clearStoredAuthState(instanceUrl: string): Promise<void> {
  await SecureStore.deleteItemAsync(buildAuthStorageKey(instanceUrl));
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

export async function loadStoredInstanceConfig(): Promise<InstanceConfig | null> {
  const raw = await SecureStore.getItemAsync(INSTANCE_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return parseInstanceConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    logger.warn('Discarding invalid stored instance config', { error });
    await clearStoredInstanceConfig();
    return null;
  }
}

export async function saveStoredInstanceConfig(instance: InstanceConfig): Promise<void> {
  await SecureStore.setItemAsync(INSTANCE_STORAGE_KEY, JSON.stringify(instance), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function clearStoredInstanceConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(INSTANCE_STORAGE_KEY);
}
