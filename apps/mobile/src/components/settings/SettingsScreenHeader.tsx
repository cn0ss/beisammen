import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useGT } from 'gt-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface SettingsScreenHeaderProps {
  eyebrow: string;
  title: string;
}

/**
 * Eyebrow + serif title with a plain "<" chevron inline with the title.
 * Navigation also works via iOS swipe-back / Android back.
 */
export const SettingsScreenHeader = memo(function SettingsScreenHeader({
  eyebrow,
  title,
}: SettingsScreenHeaderProps) {
  const router = useRouter();
  const theme = useTheme();
  const gt = useGT();

  return (
    <View style={styles.header}>
      <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>{eyebrow}</Text>
      <View style={styles.titleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt('Zurück')}
          hitSlop={12}
          onPress={() => {
            router.back();
          }}
          style={({ pressed }) => [styles.backChevron, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>
        <Text
          style={[styles.title, { color: theme.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {title}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    // Optically align the chevron with the title's left edge.
    marginLeft: -6,
  },
  backChevron: {
    height: 36,
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
});
