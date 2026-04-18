import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ComposeFabProps {
  hasDraft: boolean;
  draftAssetCount: number;
  isUploading: boolean;
  onPress: () => void;
}

export const ComposeFab = memo(function ComposeFab({
  hasDraft,
  draftAssetCount,
  isUploading,
  onPress,
}: ComposeFabProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: theme.primary,
          transform: [{ scale: pressed ? 0.92 : 1 }],
          opacity: pressed ? 0.9 : 1,
          ...Platform.select({
            ios: { shadowColor: theme.primary },
            android: {},
          }),
        },
      ]}
    >
      {isUploading ? (
        <ActivityIndicator size="small" color={theme.primaryText} />
      ) : (
        <Ionicons
          name={hasDraft ? 'create-outline' : 'add'}
          size={hasDraft ? 22 : 28}
          color={theme.primaryText}
        />
      )}

      {hasDraft && draftAssetCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <Text style={styles.badgeText}>{draftAssetCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: FontSize.xs,
    fontWeight: '800',
  },
});
