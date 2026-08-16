import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { MemoryPlaceFacet } from '@/features/convex/api';
import { useTheme } from '@/hooks/use-theme';

interface MemoryPlacesMapProps {
  places: MemoryPlaceFacet[];
  selectedPlaceKey: string | null;
  onSelectPlace: (place: MemoryPlaceFacet) => void;
}

export const MemoryPlacesMap = memo(function MemoryPlacesMap({
  onSelectPlace,
  places,
  selectedPlaceKey,
}: MemoryPlacesMapProps) {
  const theme = useTheme();

  return (
    <View style={[styles.frame, { backgroundColor: theme.surfacePressed }]}>
      <View style={styles.heading}>
        <Ionicons name="map-outline" size={22} color={theme.primary} />
        <Text style={[styles.title, { color: theme.text }]}>Orte</Text>
      </View>
      <View style={styles.placeGrid}>
        {places.slice(0, 8).map((place) => {
          const isSelected = place.key === selectedPlaceKey;

          return (
            <Pressable
              key={place.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelectPlace(place)}
              style={({ pressed }) => [
                styles.placePill,
                {
                  backgroundColor: isSelected ? theme.primary : theme.surface,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Text
                style={[styles.placeLabel, { color: isSelected ? theme.primaryText : theme.text }]}
                numberOfLines={1}
              >
                {place.label}
              </Text>
              <Text
                style={[
                  styles.placeCount,
                  { color: isSelected ? theme.primaryText : theme.textTertiary },
                ]}
              >
                {place.itemCount}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    minHeight: 220,
    justifyContent: 'space-between',
    overflow: 'hidden',
    borderRadius: Radius.xl,
    padding: Spacing.lg,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  placeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  placePill: {
    maxWidth: '48%',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
  },
  placeLabel: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  placeCount: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '900',
  },
});
