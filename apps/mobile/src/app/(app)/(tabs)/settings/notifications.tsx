import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGT } from 'gt-react-native';

import { useConvexAuth, useMutation, useQuery } from 'convex/react';

import type { NotificationKind } from '@beisammen/contracts';

import { Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { api } from '@/features/convex/api';
import { saveNotificationPreference } from '@/features/notifications/preferences';
import { useTheme } from '@/hooks/use-theme';

import { FeedbackToast } from '@/components/ui';
import { NotificationPreferencesCard } from '@/components/settings/NotificationPreferencesCard';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';

export default function NotificationsScreen() {
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const gt = useGT();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const notificationPreferences = useQuery(
    api.notifications.getPreferences,
    hasViewer ? {} : 'skip',
  );
  const updateNotificationPreference = useMutation(api.notifications.updatePreferences);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyNotificationKind, setBusyNotificationKind] = useState<NotificationKind | null>(null);

  const handleToggleNotification = useCallback(
    async (kind: NotificationKind, enabled: boolean) => {
      setBusyNotificationKind(kind);
      setFeedback(null);

      try {
        await saveNotificationPreference({
          updatePreference: updateNotificationPreference,
          kind,
          enabled,
        });
        setFeedback(enabled ? gt('Push-Mitteilung aktiviert.') : gt('Push-Mitteilung deaktiviert.'));
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : gt('Push-Mitteilung konnte nicht geändert werden.'),
        );
      } finally {
        setBusyNotificationKind(null);
      }
    },
    [gt, updateNotificationPreference],
  );

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader eyebrow={gt('Einstellungen')} title={gt('Benachrichtigungen')} />
        </Animated.View>

        <Animated.View entering={enterSection(1)}>
          <NotificationPreferencesCard
            preferences={notificationPreferences}
            busyKind={busyNotificationKind}
            onToggle={handleToggleNotification}
          />
        </Animated.View>
      </Animated.ScrollView>

      <FeedbackToast message={feedback} onDismiss={handleDismissFeedback} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
});
