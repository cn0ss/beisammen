import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeBaseUrl } from '@beisammen/contracts';

import { BrandMark, Button, Card } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { defaultInstanceConfig } from '@/features/instances/catalog';
import { resolveInstanceConfig } from '@/features/instances/discovery';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

function useFadeIn(delay: number) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [delay, opacity, translateY]);

  return { opacity, transform: [{ translateY }] };
}

export default function SignInScreen() {
  const {
    instance,
    instanceError,
    isBusy,
    isReady,
    pendingInviteToken,
    session,
    setActiveInstance,
    signIn,
  } = useSession();
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const [customInstanceUrl, setCustomInstanceUrl] = useState(instance.instance.baseUrl);
  const [isInstanceEditorOpen, setIsInstanceEditorOpen] = useState(false);
  const [isSwitchingInstance, setIsSwitchingInstance] = useState(false);
  const [instanceSwitchError, setInstanceSwitchError] = useState<string | null>(null);
  const [instanceSwitchMessage, setInstanceSwitchMessage] = useState<string | null>(null);

  const heroAnim = useFadeIn(100);
  const featuresAnim = useFadeIn(250);
  const actionAnim = useFadeIn(400);
  const footerAnim = useFadeIn(550);
  const isDefaultInstance =
    normalizeBaseUrl(instance.instance.baseUrl) ===
    normalizeBaseUrl(defaultInstanceConfig.instance.baseUrl);

  useEffect(() => {
    setCustomInstanceUrl(instance.instance.baseUrl);
  }, [instance.instance.baseUrl]);

  async function handleSwitchInstance() {
    const nextUrl = customInstanceUrl.trim();

    if (!nextUrl) {
      setInstanceSwitchError('Gib die Backend-Adresse deiner Instanz ein.');
      setInstanceSwitchMessage(null);
      return;
    }

    setIsSwitchingInstance(true);
    setInstanceSwitchError(null);
    setInstanceSwitchMessage(null);

    try {
      const nextInstance = await resolveInstanceConfig(nextUrl);
      await setActiveInstance(nextInstance);
      setCustomInstanceUrl(nextInstance.instance.baseUrl);
      setInstanceSwitchMessage(`Verbunden mit ${nextInstance.instance.name}.`);
      setIsInstanceEditorOpen(false);
    } catch (error) {
      setInstanceSwitchError(
        error instanceof Error
          ? error.message
          : 'Instanz konnte nicht geprüft werden.',
      );
    } finally {
      setIsSwitchingInstance(false);
    }
  }

  async function handleResetInstance() {
    setIsSwitchingInstance(true);
    setInstanceSwitchError(null);
    setInstanceSwitchMessage(null);

    try {
      await setActiveInstance(defaultInstanceConfig);
      setCustomInstanceUrl(defaultInstanceConfig.instance.baseUrl);
      setInstanceSwitchMessage(`Verbunden mit ${defaultInstanceConfig.instance.name}.`);
      setIsInstanceEditorOpen(false);
    } catch (error) {
      setInstanceSwitchError(
        error instanceof Error
          ? error.message
          : 'Standard-Instanz konnte nicht aktiviert werden.',
      );
    } finally {
      setIsSwitchingInstance(false);
    }
  }

  if (session) {
    return <Redirect href={pendingInviteToken ? '/(app)/invite' : '/(app)/home'} />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        <Animated.View style={[styles.hero, heroAnim]}>
          <View style={styles.logoWrap}>
            <BrandMark size={52} tone={colorScheme === 'dark' ? 'light' : 'dark'} />
          </View>
          <Text style={[styles.brand, { color: theme.text }]}>beisammen</Text>
          <Text style={[styles.tagline, { color: theme.textSecondary }]}>
            {pendingInviteToken
              ? 'Melde dich an, um deine Circle-Einladung zu öffnen.'
              : 'Familien- und Partner-Medien\nprivat und selbstbestimmt teilen.'}
          </Text>
        </Animated.View>

        <Animated.View style={[styles.features, featuresAnim]}>
          <FeatureRow
            icon="lock-closed-outline"
            text="Deine Daten bleiben privat und unter deiner Kontrolle"
            theme={theme}
          />
          <FeatureRow
            icon="images-outline"
            text="Fotos und Videos gebündelt mit der Familie teilen"
            theme={theme}
          />
          <FeatureRow
            icon="heart-outline"
            text="Für Paare, Familien und enge Freundeskreise"
            theme={theme}
          />
        </Animated.View>

        <Animated.View style={[styles.actionArea, actionAnim]}>
          <Pressable
            onPress={() => {
              setIsInstanceEditorOpen((value) => !value);
              setInstanceSwitchError(null);
              setInstanceSwitchMessage(null);
            }}
            style={({ pressed }) => [
              styles.instanceChip,
              {
                backgroundColor: theme.primaryMuted,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.instanceChipText, { color: theme.primary }]} numberOfLines={1}>
              {instance.instance.name}
            </Text>
            <Ionicons
              name={isInstanceEditorOpen ? 'chevron-up-outline' : 'server-outline'}
              size={14}
              color={theme.primary}
            />
          </Pressable>

          {isInstanceEditorOpen ? (
            <Card style={[styles.instanceEditor, { borderColor: theme.borderLight }]}>
              <View style={styles.instanceHeader}>
                <Ionicons name="server-outline" size={18} color={theme.primary} />
                <View style={styles.instanceHeaderCopy}>
                  <Text style={[styles.instanceTitle, { color: theme.text }]}>
                    Backend vor der Anmeldung
                  </Text>
                  <Text style={[styles.instanceSubtitle, { color: theme.textSecondary }]}>
                    Login läuft über die aktive Instanz.
                  </Text>
                </View>
              </View>

              <TextInput
                value={customInstanceUrl}
                onChangeText={setCustomInstanceUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://deine-instanz.example.com"
                placeholderTextColor={theme.textTertiary}
                editable={!isSwitchingInstance}
                style={[
                  styles.instanceInput,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    backgroundColor: theme.background,
                  },
                ]}
              />

              {instanceSwitchError ? (
                <Text style={[styles.instanceError, { color: theme.danger }]}>
                  {instanceSwitchError}
                </Text>
              ) : null}

              <View style={styles.instanceActions}>
                <Button
                  label="Prüfen"
                  icon="checkmark-circle-outline"
                  loading={isSwitchingInstance}
                  disabled={!isReady}
                  onPress={() => {
                    void handleSwitchInstance();
                  }}
                />
                {!isDefaultInstance ? (
                  <Button
                    label="Cloud"
                    icon="cloud-outline"
                    variant="outline"
                    disabled={isSwitchingInstance || !isReady}
                    onPress={() => {
                      void handleResetInstance();
                    }}
                  />
                ) : null}
              </View>
            </Card>
          ) : null}

          {instanceError ? (
            <View style={[styles.errorBanner, { backgroundColor: theme.dangerMuted }]}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
              <Text style={[styles.errorText, { color: theme.danger }]}>{instanceError}</Text>
            </View>
          ) : null}

          {instanceSwitchMessage ? (
            <View style={[styles.successBanner, { backgroundColor: theme.primaryMuted }]}>
              <Ionicons name="checkmark-circle-outline" size={15} color={theme.primary} />
              <Text style={[styles.successText, { color: theme.primary }]}>
                {instanceSwitchMessage}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => {
              void signIn();
            }}
            disabled={!isReady || isSwitchingInstance || isBusy}
            style={({ pressed }) => [
              styles.signInBtn,
              {
                backgroundColor: theme.primary,
                opacity: pressed || isBusy ? 0.85 : !isReady || isSwitchingInstance ? 0.6 : 1,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              },
            ]}
          >
            <Ionicons name="log-in-outline" size={20} color={theme.primaryText} />
            <Text style={[styles.signInLabel, { color: theme.primaryText }]}>
              {!isReady
                ? 'Instanz wird geladen...'
                : isSwitchingInstance
                  ? 'Instanz wird geprüft...'
                  : isBusy
                    ? 'Anmeldung läuft...'
                    : pendingInviteToken
                      ? 'Anmelden und Einladung öffnen'
                      : 'Anmelden'}
            </Text>
          </Pressable>

          <Text style={[styles.hint, { color: theme.textTertiary }]}>
            {pendingInviteToken
              ? `Einladung liegt bereit · ${instance.instance.name}`
              : `Verbunden mit ${instance.instance.name}`}
          </Text>
        </Animated.View>

        <Animated.View style={footerAnim}>
          <Text style={[styles.footer, { color: theme.textTertiary }]}>
            Deine Erinnerungen, dein Speicher
          </Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

function FeatureRow({
  icon,
  text,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIcon, { backgroundColor: theme.primaryMuted }]}>
        <Ionicons name={icon} size={17} color={theme.primary} />
      </View>
      <Text style={[styles.featureText, { color: theme.textSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing['2xl'],
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  brand: {
    fontFamily: Fonts.display,
    fontSize: FontSize['3xl'],
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  tagline: {
    fontSize: FontSize.base,
    lineHeight: 23,
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  features: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    fontSize: FontSize.base,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  actionArea: {
    gap: Spacing.lg,
    alignItems: 'stretch',
  },
  instanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  instanceChipText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  instanceEditor: {
    borderWidth: 1,
  },
  instanceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  instanceHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  instanceTitle: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  instanceSubtitle: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  instanceInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    fontSize: FontSize.base,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  instanceActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  instanceError: {
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  errorText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  successText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: '600',
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    paddingVertical: 16,
  },
  signInLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  hint: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    lineHeight: 17,
    letterSpacing: -0.1,
  },
  footer: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
