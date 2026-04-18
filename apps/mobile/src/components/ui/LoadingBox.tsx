import { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const LoadingBox = memo(function LoadingBox() {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.primary} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
});
