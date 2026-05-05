const STORAGE_KEY_PREFIX = 'beisammen.auth.';
const INVITE_STORAGE_KEY_PREFIX = 'beisammen.invite.';

export function buildPerInstanceStorageKey(prefix: string, instanceUrl: string): string {
  return `${prefix}${instanceUrl.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

export function buildAuthStorageKey(instanceUrl: string): string {
  return buildPerInstanceStorageKey(STORAGE_KEY_PREFIX, instanceUrl);
}

export function buildInviteStorageKey(instanceUrl: string): string {
  return buildPerInstanceStorageKey(INVITE_STORAGE_KEY_PREFIX, instanceUrl);
}
