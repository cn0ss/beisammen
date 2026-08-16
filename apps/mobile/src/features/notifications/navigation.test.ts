import { describe, expect, test } from 'vitest';

import { buildNotificationHref } from './navigation';

describe('notification navigation', () => {
  test('routes share notifications to share detail', () => {
    expect(buildNotificationHref({ shareBatchId: 'share 1' })).toBe('/share/share%201');
  });

  test('includes asset deep-link data when present', () => {
    expect(buildNotificationHref({ shareBatchId: 'share 1', assetId: 'asset 2' })).toBe(
      '/share/share%201?assetId=asset%202',
    );
  });

  test('ignores notifications without a share id', () => {
    expect(buildNotificationHref({ assetId: 'asset 2' })).toBeNull();
  });
});
