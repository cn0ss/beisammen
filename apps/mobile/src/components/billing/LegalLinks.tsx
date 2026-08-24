import { useGT, useLocale } from 'gt-react-native';
import { Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';
import { privacyPolicyUrl, termsOfUseUrl } from '@/features/legal/links';
import { useTheme } from '@/hooks/use-theme';

interface LegalLinksProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Terms of Use (EULA) and privacy policy links shown next to every
 * subscription entry point (paywall triggers, plan screen). Required by App
 * Store guideline 3.1.2 for auto-renewable subscriptions.
 */
export function LegalLinks({ style }: LegalLinksProps) {
  const theme = useTheme();
  const gt = useGT();
  const locale = useLocale();
  const termsUrl = termsOfUseUrl();
  const privacyUrl = privacyPolicyUrl(locale);

  return (
    <View style={[styles.row, style]}>
      {termsUrl ? (
        <>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => {
              void Linking.openURL(termsUrl);
            }}
          >
            <Text style={[styles.link, { color: theme.textSecondary }]}>
              {gt('Nutzungsbedingungen (EULA)')}
            </Text>
          </Pressable>
          <Text style={[styles.separator, { color: theme.textTertiary }]}>·</Text>
        </>
      ) : null}
      <Pressable
        accessibilityRole="link"
        hitSlop={8}
        onPress={() => {
          void Linking.openURL(privacyUrl);
        }}
      >
        <Text style={[styles.link, { color: theme.textSecondary }]}>
          {gt('Datenschutzerklärung')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  link: {
    fontSize: FontSize.xs,
    lineHeight: 16,
    textDecorationLine: 'underline',
  },
  separator: {
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
});
