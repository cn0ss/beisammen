const INVITE_STORAGE_KEY_PREFIX = 'beisammen.invite.';

export function buildPerInstanceStorageKey(prefix: string, instanceUrl: string): string {
  return `${prefix}${instanceUrl.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

export function buildInviteStorageKey(instanceUrl: string): string {
  return buildPerInstanceStorageKey(INVITE_STORAGE_KEY_PREFIX, instanceUrl);
}

const ACTIVE_CIRCLE_STORAGE_KEY_PREFIX = 'beisammen.circle.';

export function buildActiveCircleStorageKey(instanceUrl: string): string {
  return buildPerInstanceStorageKey(ACTIVE_CIRCLE_STORAGE_KEY_PREFIX, instanceUrl);
}
