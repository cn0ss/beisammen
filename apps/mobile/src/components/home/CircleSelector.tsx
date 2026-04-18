import { Image } from 'expo-image';
import { memo, useCallback, useMemo } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Fonts, FontSize, Spacing } from '@/constants/theme';
import type { CircleListItem } from '@/features/convex/api';
import { useCircleImageUrl } from '@/features/media/use-circle-image-url';
import { useTheme } from '@/hooks/use-theme';

interface CircleSelectorProps {
  circles: CircleListItem[];
  activeCircleId: string | null;
  onSelect: (circleId: string) => void;
}

const TILE_WIDTH = 84;
const TILE_HEIGHT = 108;

// Warm editorial palette — deterministic per circle name.
// Each entry is a two-tone pair (base + deeper shade for the initial glyph).
const SEED_PALETTES = [
  { base: '#E8D7BD', deep: '#5A3E1B' }, // sand
  { base: '#CFDECB', deep: '#284A36' }, // sage
  { base: '#EDD1BE', deep: '#6C2E14' }, // terracotta
  { base: '#D8CEDF', deep: '#3D2A47' }, // plum
  { base: '#C9D8DF', deep: '#1F3A48' }, // slate
  { base: '#EADFB8', deep: '#4C3A0C' }, // mustard
  { base: '#E3C9C6', deep: '#5E2A2A' }, // clay
  { base: '#CEDBD3', deep: '#2D4238' }, // moss
] as const;

function hashIndex(str: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}

export const CircleSelector = memo(function CircleSelector({
  circles,
  activeCircleId,
  onSelect,
}: CircleSelectorProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      decelerationRate="fast"
    >
      {circles.map((circle) => (
        <CircleTile
          key={circle._id}
          circle={circle}
          isActive={circle._id === activeCircleId}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
});

interface CircleTileProps {
  circle: CircleListItem;
  isActive: boolean;
  onSelect: (id: string) => void;
}

const CircleTile = memo(function CircleTile({ circle, isActive, onSelect }: CircleTileProps) {
  const theme = useTheme();
  const imageUrl = useCircleImageUrl(circle._id, circle.hasImage);
  const handlePress = useCallback(() => onSelect(circle._id), [onSelect, circle._id]);

  const palette = useMemo(
    () => SEED_PALETTES[hashIndex(circle.name, SEED_PALETTES.length)],
    [circle.name],
  );
  const initial = useMemo(
    () => (circle.name.trim().charAt(0) || '•').toUpperCase(),
    [circle.name],
  );

  const hasImage = Boolean(circle.hasImage && imageUrl);
  const ringColor = isActive ? theme.accent : 'transparent';
  const outerShadow = isActive ? theme.accent : theme.text;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Circle ${circle.name}`}
      accessibilityState={{ selected: isActive }}
      style={({ pressed }) => [
        styles.wrapper,
        {
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      <View
        style={[
          styles.ringOuter,
          {
            borderColor: ringColor,
            ...Platform.select({
              ios: {
                shadowColor: outerShadow,
                shadowOffset: { width: 0, height: isActive ? 6 : 3 },
                shadowOpacity: isActive ? 0.22 : 0.1,
                shadowRadius: isActive ? 14 : 8,
              },
              android: {
                elevation: isActive ? 6 : 2,
              },
            }),
          },
        ]}
      >
        <View style={[styles.tile, { backgroundColor: palette.base }]}>
          {hasImage ? (
            <Image
              source={{ uri: imageUrl! }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={240}
              recyclingKey={circle._id}
            />
          ) : (
            <>
              {/* subtle inner "paper" highlight to avoid flat feel */}
              <View
                pointerEvents="none"
                style={[styles.innerHighlight, { backgroundColor: 'rgba(255,255,255,0.28)' }]}
              />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={[styles.initial, { color: palette.deep }]}
              >
                {initial}
              </Text>
              {/* corner fold accent */}
              <View
                pointerEvents="none"
                style={[styles.cornerFold, { backgroundColor: palette.deep, opacity: 0.12 }]}
              />
            </>
          )}

          {/* active indicator */}
          {isActive ? (
            <View
              pointerEvents="none"
              style={[styles.activePip, { backgroundColor: theme.accent }]}
            />
          ) : null}
        </View>
      </View>

      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: isActive ? theme.text : theme.textSecondary,
            fontWeight: isActive ? '700' : '600',
          },
        ]}
      >
        {circle.name}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 6,
    paddingBottom: 8,
    gap: Spacing.md,
  },
  wrapper: {
    width: TILE_WIDTH,
    alignItems: 'center',
    gap: 8,
  },
  ringOuter: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: 18,
    borderWidth: 2,
    padding: 2,
  },
  tile: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
  },
  initial: {
    fontFamily: Fonts.display,
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1.5,
    textAlign: 'center',
    marginTop: -2,
  },
  cornerFold: {
    position: 'absolute',
    bottom: -14,
    right: -14,
    width: 34,
    height: 34,
    borderRadius: 4,
    transform: [{ rotate: '45deg' }],
  },
  activePip: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    fontSize: FontSize.xs,
    letterSpacing: 0.2,
    textAlign: 'center',
    maxWidth: TILE_WIDTH,
  },
});
