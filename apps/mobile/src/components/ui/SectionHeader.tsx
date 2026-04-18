import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface SectionHeaderProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count?: number;
}

export const SectionHeader = memo(function SectionHeader({
  icon,
  label,
  count,
}: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={15} color={theme.textTertiary} />
      <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text>
      {count !== undefined ? (
        <View style={[styles.badge, { backgroundColor: theme.primaryMuted }]}>
          <Text style={[styles.badgeText, { color: theme.primary }]}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: Radius.full,
  },
  badgeText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
});
