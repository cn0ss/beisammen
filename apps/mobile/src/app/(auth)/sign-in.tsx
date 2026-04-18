import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
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
  const { instance, instanceError, isBusy, pendingInviteToken, session, signIn } = useSession();
  const theme = useTheme();
  const colorScheme = useColorScheme();

  const heroAnim = useFadeIn(100);
  const featuresAnim = useFadeIn(250);
  const actionAnim = useFadeIn(400);
  const footerAnim = useFadeIn(550);

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
            Familien- und Partner-Medien{'\n'}privat und selbstbestimmt teilen.
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
          <View style={[styles.instanceChip, { backgroundColor: theme.primaryMuted }]}>
            <View style={[styles.dot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.instanceChipText, { color: theme.primary }]} numberOfLines={1}>
              {instance.instance.name}
            </Text>
          </View>

          {instanceError ? (
            <View style={[styles.errorBanner, { backgroundColor: theme.dangerMuted }]}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
              <Text style={[styles.errorText, { color: theme.danger }]}>{instanceError}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => {
              void signIn();
            }}
            style={({ pressed }) => [
              styles.signInBtn,
              {
                backgroundColor: theme.primary,
                opacity: pressed || isBusy ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              },
            ]}
          >
            <Ionicons name="log-in-outline" size={20} color={theme.primaryText} />
            <Text style={[styles.signInLabel, { color: theme.primaryText }]}>
              {isBusy ? 'Anmeldung läuft...' : 'Anmelden'}
            </Text>
          </Pressable>

          <Text style={[styles.hint, { color: theme.textTertiary }]}>
            Verbunden mit {instance.instance.name}
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
