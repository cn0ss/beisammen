import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { box: 32, radius: 10, fontSize: FontSize.sm },
  md: { box: 44, radius: 14, fontSize: FontSize.base },
  lg: { box: 52, radius: Radius.lg, fontSize: FontSize.md },
} as const;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const Avatar = memo(function Avatar({ name, imageUrl, size = 'md' }: AvatarProps) {
  const theme = useTheme();
  const dim = sizeMap[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: dim.box,
          height: dim.box,
          borderRadius: dim.radius,
          backgroundColor: theme.primaryMuted,
          borderColor: theme.borderLight,
          borderWidth: 1,
        },
      ]}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />
      ) : (
        <Text
          style={[
            styles.initials,
            { color: theme.primary, fontSize: dim.fontSize },
          ]}
        >
          {getInitials(name)}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initials: {
    fontFamily: Fonts.display,
    fontWeight: '700',
  },
});
