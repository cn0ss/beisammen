import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable } from '@/components/ui';

interface SettingsNavRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  tone?: 'primary' | 'accent';
  hasSeparator?: boolean;
  onPress: () => void;
}

/** One tappable row of the settings hub: icon bubble, title, subtitle, chevron. */
export const SettingsNavRow = memo(function SettingsNavRow({
  icon,
  title,
  subtitle,
  tone = 'primary',
  hasSeparator = false,
  onPress,
}: SettingsNavRowProps) {
  const theme = useTheme();
  const bubbleColor = tone === 'accent' ? theme.accentMuted : theme.primaryMuted;
  const iconColor = tone === 'accent' ? theme.accent : theme.primary;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      pressedScale={0.98}
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <View style={[styles.iconBubble, { backgroundColor: bubbleColor }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward-outline" size={16} color={theme.textTertiary} />
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: FontSize.base,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
});
