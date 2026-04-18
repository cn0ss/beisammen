import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Decorative editorial separator — thin rule with a centered serif diamond.
 * Rendered between feed cards to evoke a printed photo album page.
 */
export const Ornament = memo(function Ornament() {
  const theme = useTheme();

  return (
    <View style={styles.row} pointerEvents="none" accessibilityElementsHidden>
      <View style={[styles.rule, { backgroundColor: theme.border }]} />
      <Text
        allowFontScaling={false}
        style={[styles.glyph, { color: theme.accent }]}
      >
        ◆
      </Text>
      <View style={[styles.rule, { backgroundColor: theme.border }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    opacity: 0.8,
  },
  glyph: {
    fontFamily: Fonts.display,
    fontSize: 9,
    opacity: 0.75,
  },
});
