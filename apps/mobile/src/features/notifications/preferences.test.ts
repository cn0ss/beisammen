import { describe, expect, test, vi } from 'vitest';

import type { NotificationPreference } from '@beisammen/contracts';

import {
  NOTIFICATION_PREFERENCE_ROWS,
  notificationPreferenceEnabled,
  saveNotificationPreference,
} from './preferences';

describe('notification preferences', () => {
  test('defines copy for every notification kind', () => {
    expect(NOTIFICATION_PREFERENCE_ROWS.map((row) => row.kind)).toEqual([
      'share.published',
      'comment.created',
      'reaction.set',
    ]);
    expect(NOTIFICATION_PREFERENCE_ROWS.map((row) => row.label)).toEqual([
      'Neue Beiträge',
      'Kommentare',
      'Reaktionen',
    ]);
  });

  test('defaults missing preferences to enabled', () => {
    const preferences: NotificationPreference[] = [
      {
        kind: 'comment.created',
        enabled: false,
        updatedAt: 1,
      },
    ];

    expect(notificationPreferenceEnabled(preferences, 'comment.created')).toBe(false);
    expect(notificationPreferenceEnabled(preferences, 'share.published')).toBe(true);
  });

  test('saves toggles through the update preference mutation shape', async () => {
    const updatePreference = vi.fn(async (args) => ({
      ...args,
      updatedAt: 2,
    }));

    await expect(
      saveNotificationPreference({
        updatePreference,
        kind: 'reaction.set',
        enabled: false,
      }),
    ).resolves.toEqual({
      kind: 'reaction.set',
      enabled: false,
      updatedAt: 2,
    });
    expect(updatePreference).toHaveBeenCalledWith({
      kind: 'reaction.set',
      enabled: false,
    });
  });
});
