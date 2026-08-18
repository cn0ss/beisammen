import { T, useGT } from 'gt-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, FontSize, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { useCrypto } from '@/features/crypto/provider';
import { useTheme } from '@/hooks/use-theme';

import { Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { RecoveryCodeBlock } from '@/components/crypto/RecoveryCodeBlock';
import { RecoveryCodeEntryForm } from '@/components/crypto/RecoveryCodeEntryForm';
import { ResetKeysSection } from '@/components/crypto/ResetKeysSection';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';

export default function RecoveryCodeScreen() {
  const theme = useTheme();
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { status, getRecoveryCode } = useCrypto();
  const [code, setCode] = useState<string | null>(null);
  const [hasDeriveError, setHasDeriveError] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Re-derives the code from the unlocked master key; after a successful
  // recovery on this screen the status flips to 'ready' and the code appears.
  useEffect(() => {
    if (status !== 'ready') {
      setCode(null);
      return;
    }

    let cancelled = false;

    setHasDeriveError(false);
    void getRecoveryCode()
      .then((value) => {
        if (!cancelled) {
          setCode(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasDeriveError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getRecoveryCode, status]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader
            eyebrow={gt('Einstellungen')}
            title={gt('Wiederherstellungscode')}
          />
        </Animated.View>

        <Animated.View entering={enterSection(1)}>
          {status === 'recovery-required' ? (
            <View style={styles.stack}>
              <Card style={styles.card}>
                <T>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    Auf diesem Gerät fehlt der Schlüssel für deine verschlüsselten Fotos. Gib
                    deinen Wiederherstellungscode ein, um den Zugriff wiederherzustellen.
                  </Text>
                </T>
                <RecoveryCodeEntryForm
                  onRecovered={() => setFeedback(gt('Zugriff wiederhergestellt.'))}
                />
              </Card>
              <Card style={styles.card}>
                <ResetKeysSection />
              </Card>
            </View>
          ) : status === 'ready' ? (
            <Card style={styles.card}>
              <T>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Mit diesem Code bekommst du auf einem neuen Gerät wieder Zugriff auf deine
                  verschlüsselten Fotos. Auf dem iPhone hilft zusätzlich der iCloud-Schlüsselbund.
                  Bewahre den Code sicher auf und teile ihn mit niemandem.
                </Text>
              </T>
              {code ? (
                <RecoveryCodeBlock
                  code={code}
                  onCopied={() => setFeedback(gt('Code kopiert.'))}
                  onExportFailed={() =>
                    setFeedback(gt('Export fehlgeschlagen. Bitte versuche es erneut.'))
                  }
                />
              ) : hasDeriveError ? (
                <T>
                  <Text style={[styles.body, { color: theme.danger }]}>
                    Der Code konnte nicht ermittelt werden. Bitte versuche es später erneut.
                  </Text>
                </T>
              ) : (
                <LoadingBox />
              )}
            </Card>
          ) : (
            <Card style={styles.card}>
              <T>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Die Verschlüsselung wird gerade vorbereitet. Bitte versuche es gleich noch
                  einmal.
                </Text>
              </T>
            </Card>
          )}
        </Animated.View>
      </Animated.ScrollView>

      <View
        pointerEvents="box-none"
        style={[styles.toast, { bottom: insets.bottom + BottomTabInset + Spacing.lg }]}
      >
        <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
      </View>
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
  stack: {
    gap: Spacing.lg,
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
