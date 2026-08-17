import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { T } from 'gt-react-native';

import { FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { MemoryMapItem } from '@/features/convex/api';
import { MemoryTile } from '@/features/memories/MemoryTile';
import { useTheme } from '@/hooks/use-theme';

const GRID_COLUMNS = 3;
const GRID_GAP = 6;

interface MemoryMapExplorerProps {
  items: MemoryMapItem[] | undefined;
  onOpenMemory: (item: MemoryMapItem) => void;
}

/** Web fallback: no native map — plain list of located memories. */
export const MemoryMapExplorer = memo(function MemoryMapExplorer({
  items,
  onOpenMemory,
}: MemoryMapExplorerProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, MaxContentWidth) - Spacing.lg * 2;
  const tileSize = Math.floor((contentWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const located = items ?? [];

  return (
    <View style={styles.container}>
      <View style={[styles.notice, { backgroundColor: theme.surface }]}>
        <Ionicons name="map-outline" size={18} color={theme.primary} />
        <T>
          <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
            Die interaktive Karte gibt es in der App. Hier sind alle Erinnerungen mit Standort.
          </Text>
        </T>
      </View>
      <View style={styles.grid}>
        {located.map((item) => (
          <MemoryTile key={item._id} item={item} size={tileSize} onOpen={() => onOpenMemory(item)} />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing.lg,
    padding: Spacing.lg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
});
