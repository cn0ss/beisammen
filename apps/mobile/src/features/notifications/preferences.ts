import type { NotificationKind, NotificationPreference } from '@beisammen/contracts';

export const NOTIFICATION_PREFERENCE_ROWS: Array<{
  kind: NotificationKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'share.published',
    label: 'Neue Beiträge',
    description: 'Wenn jemand in einem deiner Circles Fotos oder Videos teilt.',
  },
  {
    kind: 'comment.created',
    label: 'Kommentare',
    description: 'Wenn jemand auf einen Beitrag oder ein einzelnes Medium antwortet.',
  },
  {
    kind: 'reaction.set',
    label: 'Reaktionen',
    description: 'Wenn jemand mit einem Emoji auf gemeinsame Erinnerungen reagiert.',
  },
];

export function notificationPreferenceEnabled(
  preferences: NotificationPreference[] | undefined,
  kind: NotificationKind,
): boolean {
  return preferences?.find((preference) => preference.kind === kind)?.enabled ?? true;
}

export async function saveNotificationPreference(input: {
  updatePreference: (args: {
    kind: NotificationKind;
    enabled: boolean;
  }) => Promise<NotificationPreference>;
  kind: NotificationKind;
  enabled: boolean;
}): Promise<NotificationPreference> {
  return await input.updatePreference({
    kind: input.kind,
    enabled: input.enabled,
  });
}
