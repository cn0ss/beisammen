import * as SecureStore from 'expo-secure-store';

import type { InstanceConfig } from '@beisammen/contracts';
import { parseInstanceConfig } from '@beisammen/contracts';

import { createLogger } from '@/lib/logger';
import { buildActiveCircleStorageKey, buildInviteStorageKey } from './session-keys';

const logger = createLogger('auth.store');
const INSTANCE_STORAGE_KEY = 'beisammen.instance.active';

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

export async function loadStoredActiveCircleId(instanceUrl: string): Promise<string | null> {
  const circleId = await SecureStore.getItemAsync(buildActiveCircleStorageKey(instanceUrl));

  if (!circleId || circleId.trim().length === 0) {
    return null;
  }

  return circleId.trim();
}

/** `null` means "all circles" — stored as absence so restarts default the same way. */
export async function saveStoredActiveCircleId(
  instanceUrl: string,
  circleId: string | null,
): Promise<void> {
  if (!circleId) {
    await SecureStore.deleteItemAsync(buildActiveCircleStorageKey(instanceUrl));
    return;
  }

  await SecureStore.setItemAsync(buildActiveCircleStorageKey(instanceUrl), circleId, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
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
