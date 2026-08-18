import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';

/**
 * "LIVE" chip marking a Live Photo, styled like the media meta chips on the
 * feed card. Rendered on dark media surfaces, so its colors are fixed.
 */
export const LivePhotoBadge = memo(function LivePhotoBadge({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, style]} pointerEvents="none">
      <Ionicons name="disc-outline" size={12} color="#FFFFFF" />
      <Text allowFontScaling={false} style={styles.text}>
        LIVE
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
  text: {
    color: '#FFFFFF',
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
