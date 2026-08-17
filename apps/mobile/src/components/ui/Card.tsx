import { memo } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

export const Card = memo(function Card({ children, style, ...rest }: CardProps) {
  const theme = useTheme();
  // Drop-shadows read as a light halo on dark backgrounds; borders carry the
  // card definition there instead.
  const isDark = useColorScheme() === 'dark';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface },
        isDark
          ? null
          : Platform.select({
              ios: {
                shadowColor: theme.text,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06,
                shadowRadius: 16,
              },
              android: { elevation: 2 },
            }),
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
});
