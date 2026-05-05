import { describe, expect, test } from 'vitest';

import { buildAuthStorageKey, buildInviteStorageKey } from './session-keys';

describe('per-instance session keys', () => {
  test('namespaces auth and invite state by normalized instance URL', () => {
    expect(buildAuthStorageKey('https://cloud.example.com')).toBe(
      'beisammen.auth.https___cloud.example.com',
    );
    expect(buildInviteStorageKey('https://cloud.example.com')).toBe(
      'beisammen.invite.https___cloud.example.com',
    );
    expect(buildAuthStorageKey('https://home.example.com')).not.toBe(
      buildAuthStorageKey('https://cloud.example.com'),
    );
  });
});
