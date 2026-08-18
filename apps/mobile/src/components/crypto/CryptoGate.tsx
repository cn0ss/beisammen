import { T, useGT } from 'gt-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { useCrypto } from '@/features/crypto/provider';
import { useTheme } from '@/hooks/use-theme';

import { Button, Card, FeedbackToast } from '@/components/ui';
import { RecoveryCodeBlock } from './RecoveryCodeBlock';
import { RecoveryCodeEntryForm } from './RecoveryCodeEntryForm';
import { ResetKeysSection } from './ResetKeysSection';

/**
 * Blocking overlays for the E2EE key lifecycle: the one-time recovery code
 * after fresh key generation (must be acknowledged), the recovery entry for
 * devices without the master key (dismissible; also reachable via
 * Einstellungen > Wiederherstellungscode, with a key reset as last resort),
 * and a retry screen when the key bootstrap failed.
 */
export function CryptoGate() {
  const theme = useTheme();
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { status, pendingRecoveryCode, acknowledgeRecoveryCode, retry } = useCrypto();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isRecoveryDismissed, setIsRecoveryDismissed] = useState(false);
  const [isUnavailableDismissed, setIsUnavailableDismissed] = useState(false);

  if (pendingRecoveryCode) {
    return (
      <View style={[styles.overlay, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <T>
              <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Verschlüsselung</Text>
              <Text style={[styles.title, { color: theme.text }]}>Dein Wiederherstellungscode</Text>
            </T>
            <Card style={styles.card}>
              <T>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Deine Fotos werden Ende-zu-Ende verschlüsselt. Dieser Code ist der einzige Weg,
                  auf einem neuen Gerät wieder Zugriff auf deine Fotos zu bekommen. Auf dem iPhone
                  hilft zusätzlich der iCloud-Schlüsselbund. Bewahre den Code sicher auf, zum
                  Beispiel in deinem Passwort-Manager.
                </Text>
              </T>
              <RecoveryCodeBlock
                code={pendingRecoveryCode}
                onCopied={() => setFeedback(gt('Code kopiert.'))}
                onExportFailed={() =>
                  setFeedback(gt('Export fehlgeschlagen. Bitte versuche es erneut.'))
                }
              />
            </Card>
            <Button
              label={gt('Ich habe den Code gesichert')}
              icon="checkmark-circle-outline"
              onPress={acknowledgeRecoveryCode}
            />
          </ScrollView>
        </SafeAreaView>
        <View
          pointerEvents="box-none"
          style={[styles.toast, { bottom: insets.bottom + Spacing.xl }]}
        >
          <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
        </View>
      </View>
    );
  }

  if (status === 'recovery-required' && !isRecoveryDismissed) {
    return (
      <View style={[styles.overlay, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <T>
              <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Verschlüsselung</Text>
              <Text style={[styles.title, { color: theme.text }]}>Zugriff wiederherstellen</Text>
            </T>
            <Card style={styles.card}>
              <T>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Auf diesem Gerät fehlt der Schlüssel für deine verschlüsselten Fotos. Gib deinen
                  Wiederherstellungscode ein, um den Zugriff wiederherzustellen.
                </Text>
              </T>
              <RecoveryCodeEntryForm />
            </Card>
            <Card style={styles.card}>
              <ResetKeysSection />
            </Card>
            <Button
              label={gt('Später')}
              variant="ghost"
              onPress={() => setIsRecoveryDismissed(true)}
            />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  if (status === 'unavailable' && !isUnavailableDismissed) {
    return (
      <View style={[styles.overlay, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <T>
              <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Verschlüsselung</Text>
              <Text style={[styles.title, { color: theme.text }]}>
                Verschlüsselung nicht bereit
              </Text>
            </T>
            <Card style={styles.card}>
              <T>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Deine Verschlüsselungsschlüssel konnten gerade nicht geladen werden, zum
                  Beispiel wegen einer fehlenden Internetverbindung. Ohne sie lassen sich Fotos
                  weder anzeigen noch teilen.
                </Text>
              </T>
              <Button label={gt('Erneut versuchen')} icon="refresh-outline" onPress={retry} />
            </Card>
            <Button
              label={gt('Später')}
              variant="ghost"
              onPress={() => setIsUnavailableDismissed(true)}
            />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing['3xl'],
    gap: Spacing.lg,
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  card: {
    gap: Spacing.md,
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  toast: {
    position: 'absolute',
    left: Spacing.xl,
    right: Spacing.xl,
  },
});
