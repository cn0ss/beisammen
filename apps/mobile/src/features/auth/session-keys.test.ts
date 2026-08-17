import { describe, expect, test } from 'vitest';

import { buildInviteStorageKey } from './session-keys';

describe('per-instance session keys', () => {
  test('namespaces invite state by normalized instance URL', () => {
    expect(buildInviteStorageKey('https://cloud.example.com')).toBe(
      'beisammen.invite.https___cloud.example.com',
    );
    expect(buildInviteStorageKey('https://home.example.com')).not.toBe(
      buildInviteStorageKey('https://cloud.example.com'),
    );
  });
});
