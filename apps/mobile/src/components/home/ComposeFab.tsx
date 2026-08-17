import Ionicons from '@expo/vector-icons/Ionicons';
import { useGT } from 'gt-react-native';
import { memo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { AnimatedPressable } from '@/components/ui/AnimatedPressable';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const FAB_SIZE = 56;

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
  const gt = useGT();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={hasDraft ? gt('Entwurf bearbeiten') : gt('Neuen Beitrag erstellen')}
        onPress={onPress}
        pressedScale={0.95}
        style={[styles.fab, { backgroundColor: theme.primary }]}
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
      </AnimatedPressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.xl,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
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
