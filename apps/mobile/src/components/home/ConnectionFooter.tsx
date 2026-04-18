import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ConnectionFooterProps {
  instanceName: string;
}

export const ConnectionFooter = memo(function ConnectionFooter({
  instanceName,
}: ConnectionFooterProps) {
  const theme = useTheme();

  return (
    <View style={[styles.chip, { backgroundColor: theme.primaryMuted }]}>
      <View style={[styles.dot, { backgroundColor: theme.primary }]} />
      <Text style={[styles.text, { color: theme.primary }]}>
        Verbunden mit {instanceName}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
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
  text: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
