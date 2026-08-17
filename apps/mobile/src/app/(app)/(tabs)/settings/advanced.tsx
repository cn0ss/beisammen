import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T, useGT } from 'gt-react-native';

import { useAction } from 'convex/react';

import type { ConnectionCheck } from '@beisammen/contracts';

import { FontSize, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { api } from '@/features/convex/api';
import { clearClientDiagnostics, formatClientDiagnostics } from '@/features/diagnostics/buffer';
import { useTheme } from '@/hooks/use-theme';

import { Button, Card, FeedbackToast, SectionHeader } from '@/components/ui';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';

export default function AdvancedScreen() {
  const theme = useTheme();
  const gt = useGT();
  const checkStorageConnection = useAction(api.storageStats.checkConnection);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck | null>(null);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);

  const handleCheckStorageConnection = useCallback(async () => {
    setIsCheckingStorage(true);
    setFeedback(null);

    try {
      const result = await checkStorageConnection({});
      setConnectionCheck(result);
    } catch (error) {
      setConnectionCheck({
        ok: false,
        message: error instanceof Error ? error.message : gt('Speicherprüfung fehlgeschlagen.'),
      });
    } finally {
      setIsCheckingStorage(false);
    }
  }, [checkStorageConnection, gt]);

  const handleShowDiagnostics = useCallback(() => {
    Alert.alert(gt('Diagnose'), formatClientDiagnostics(), [
      {
        text: gt('Leeren'),
        style: 'destructive',
        onPress: () => {
          clearClientDiagnostics();
          setFeedback(gt('Diagnoseeinträge geleert.'));
        },
      },
      {
        text: gt('OK'),
        style: 'cancel',
      },
    ]);
  }, [gt]);

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader eyebrow={gt('Einstellungen')} title={gt('Speicher & Diagnose')} />
        </Animated.View>

        <Animated.View entering={enterSection(1)} style={styles.section}>
          <SectionHeader icon="cloud-outline" label={gt('Speicherverbindung')} />
          <Card>
            <T>
              <Text style={[styles.helpText, { color: theme.textSecondary }]}>
                Prüft, ob dein Speicher erreichbar ist und Uploads funktionieren.
              </Text>
            </T>
            <Button
              label={isCheckingStorage ? gt('Prüft...') : gt('Speicher prüfen')}
              icon={connectionCheck?.ok ? 'checkmark-circle-outline' : 'cloud-outline'}
              variant="outline"
              loading={isCheckingStorage}
              onPress={handleCheckStorageConnection}
            />
            {connectionCheck ? (
              <Text
                style={[
                  styles.connectionMessage,
                  { color: connectionCheck.ok ? theme.primary : theme.danger },
                ]}
              >
                {connectionCheck.message}
              </Text>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={enterSection(2)} style={styles.section}>
          <SectionHeader icon="bug-outline" label={gt('Diagnose')} />
          <Card>
            <T>
              <Text style={[styles.helpText, { color: theme.textSecondary }]}>
                Zeigt das lokale Protokoll für die Fehlersuche.
              </Text>
            </T>
            <Button
              label={gt('Diagnose anzeigen')}
              icon="document-text-outline"
              variant="outline"
              onPress={handleShowDiagnostics}
            />
          </Card>
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
  section: {
    gap: Spacing.sm,
  },
  helpText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  connectionMessage: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 18,
  },
});
