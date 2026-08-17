import Ionicons from '@expo/vector-icons/Ionicons';
import { T, useMessages } from 'gt-react-native';
import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import type { NotificationKind, NotificationPreference } from '@beisammen/contracts';

import { Card } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import {
  NOTIFICATION_PREFERENCE_ROWS,
  notificationPreferenceEnabled,
} from '@/features/notifications/preferences';
import { useTheme } from '@/hooks/use-theme';

interface NotificationPreferencesCardProps {
  preferences: NotificationPreference[] | undefined;
  busyKind: NotificationKind | null;
  onToggle: (kind: NotificationKind, enabled: boolean) => void;
}

export const NotificationPreferencesCard = memo(function NotificationPreferencesCard({
  preferences,
  busyKind,
  onToggle,
}: NotificationPreferencesCardProps) {
  const theme = useTheme();
  const m = useMessages();
  const isLoading = preferences === undefined;

  return (
    <Card>
      <View style={styles.headerRow}>
        <View style={[styles.iconBubble, { backgroundColor: theme.primaryMuted }]}>
          <Ionicons name="notifications-outline" size={18} color={theme.primary} />
        </View>
        <View style={styles.headerCopy}>
          <T>
            <Text style={[styles.title, { color: theme.text }]}>Push-Mitteilungen</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Wähle, welche Aktivität dich außerhalb der App erreichen darf.
            </Text>
          </T>
        </View>
        {isLoading ? <ActivityIndicator size="small" color={theme.primary} /> : null}
      </View>

      <View style={styles.rows}>
        {NOTIFICATION_PREFERENCE_ROWS.map((row) => {
          const enabled = notificationPreferenceEnabled(preferences, row.kind);
          const isBusy = busyKind === row.kind;

          return (
            <View
              key={row.kind}
              style={[
                styles.row,
                {
                  borderColor: theme.borderLight,
                  opacity: isLoading ? 0.64 : 1,
                },
              ]}
            >
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{m(row.label)}</Text>
                <Text style={[styles.rowDescription, { color: theme.textSecondary }]}>
                  {m(row.description)}
                </Text>
              </View>
              {isBusy ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Switch
                  value={enabled}
                  disabled={isLoading || busyKind !== null}
                  onValueChange={(nextEnabled) => onToggle(row.kind, nextEnabled)}
                  trackColor={{
                    false: theme.surfacePressed,
                    true: theme.primaryMuted,
                  }}
                  thumbColor={enabled ? theme.primary : theme.textTertiary}
                  ios_backgroundColor={theme.surfacePressed}
                />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  rows: {
    gap: Spacing.sm,
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  rowDescription: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
});
