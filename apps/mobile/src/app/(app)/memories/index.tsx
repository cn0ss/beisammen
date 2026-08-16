import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';

import { Button, EmptyState, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type {
  CircleListItem,
  MemoryFilterArgs,
  MemoryItemRecord,
  MemoryMonthFacet,
  MemoryPlaceFacet,
} from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { MemoryPlacesMap } from '@/features/memories/MemoryPlacesMap';
import { MemoryTile } from '@/features/memories/MemoryTile';
import {
  buildMemoryMonthSections,
  buildMemoryViewerHref,
  formatMemoryMonthFacetTitle,
  normalizeMemoryFilter,
} from '@/features/memories/timeline';
import { useTheme } from '@/hooks/use-theme';

const GRID_COLUMNS = 3;
const GRID_GAP = 6;

type MemoryMode = 'timeline' | 'places';

const CircleChip = memo(function CircleChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? theme.primary : theme.surface,
          borderColor: active ? theme.primary : theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          { color: active ? theme.primaryText : theme.textSecondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const ModeButton = memo(function ModeButton({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        {
          backgroundColor: active ? theme.primary : theme.surfacePressed,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? theme.primaryText : theme.textSecondary} />
      <Text
        style={[styles.modeButtonText, { color: active ? theme.primaryText : theme.textSecondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

function MonthRail({
  activeFilter,
  months,
  onClear,
  onSelectMonth,
}: {
  activeFilter: MemoryFilterArgs | null;
  months: MemoryMonthFacet[];
  onClear: () => void;
  onSelectMonth: (month: MemoryMonthFacet) => void;
}) {
  if (months.length === 0) {
    return null;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      <CircleChip active={!activeFilter} label="Alle Monate" onPress={onClear} />
      {months.map((month) => (
        <CircleChip
          key={month.key}
          active={activeFilter?.kind === 'month' && activeFilter.key === month.key}
          label={`${formatMemoryMonthFacetTitle(month.key)} · ${month.itemCount}`}
          onPress={() => onSelectMonth(month)}
        />
      ))}
    </ScrollView>
  );
}

function PlaceRail({
  activePlaceKey,
  onClear,
  onSelectPlace,
  places,
}: {
  activePlaceKey: string | null;
  onClear: () => void;
  onSelectPlace: (place: MemoryPlaceFacet) => void;
  places: MemoryPlaceFacet[];
}) {
  if (places.length === 0) {
    return null;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      <CircleChip active={!activePlaceKey} label="Alle Orte" onPress={onClear} />
      {places.map((place) => (
        <CircleChip
          key={place.key}
          active={activePlaceKey === place.key}
          label={`${place.label} · ${place.itemCount}`}
          onPress={() => onSelectPlace(place)}
        />
      ))}
    </ScrollView>
  );
}

export default function MemoriesScreen() {
  const router = useRouter();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [mode, setMode] = useState<MemoryMode>('timeline');
  const [activeFilter, setActiveFilter] = useState<MemoryFilterArgs | null>(null);
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 40 },
  );
  const circles = hasViewer ? circlesPage.results : [];
  const discovery = useQuery(
    api.memories.discoveryForViewer,
    hasViewer ? (selectedCircleId ? { circleId: selectedCircleId } : {}) : 'skip',
  );
  const queryFilter = normalizeMemoryFilter(activeFilter);
  const memoriesPage = usePaginatedQuery(
    api.memories.listForViewer,
    hasViewer
      ? {
          ...(selectedCircleId ? { circleId: selectedCircleId } : {}),
          ...(queryFilter ? { filter: queryFilter } : {}),
        }
      : 'skip',
    { initialNumItems: 48 },
  );
  const memories = hasViewer ? memoriesPage.results : [];
  const sections = useMemo(() => buildMemoryMonthSections(memories), [memories]);
  const isLoadingFirstPage = hasViewer && memoriesPage.status === 'LoadingFirstPage';
  const isLoadingMore = memoriesPage.status === 'LoadingMore';
  const contentWidth = Math.min(width, MaxContentWidth) - Spacing.lg * 2;
  const tileSize = Math.floor((contentWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const selectedPlaceKey = activeFilter?.kind === 'place' ? activeFilter.key : null;

  useEffect(() => {
    if (selectedCircleId && circles.length > 0 && !circles.some((circle) => circle._id === selectedCircleId)) {
      setSelectedCircleId(null);
    }
  }, [circles, selectedCircleId]);

  useEffect(() => {
    setActiveFilter(null);
  }, [selectedCircleId]);

  const handleOpenMemory = (item: MemoryItemRecord) => {
    router.push(
      buildMemoryViewerHref({
        memoryId: item._id,
        circleId: selectedCircleId,
        filter: activeFilter,
      }) as never,
    );
  };

  const handleSelectPlace = (place: MemoryPlaceFacet) => {
    setMode('places');
    setActiveFilter({ kind: 'place', key: place.key });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Archiv</Text>
          <Text style={[styles.title, { color: theme.text }]}>Erinnerungen</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Fotos und Videos nach Zeit und Ort entdecken.
          </Text>
        </View>

        <View style={[styles.modeSwitch, { backgroundColor: theme.surface }]}>
          <ModeButton
            active={mode === 'timeline'}
            icon="calendar-outline"
            label="Zeitleiste"
            onPress={() => {
              setMode('timeline');
              if (activeFilter?.kind === 'place') setActiveFilter(null);
            }}
          />
          <ModeButton
            active={mode === 'places'}
            icon="map-outline"
            label="Orte"
            onPress={() => setMode('places')}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <CircleChip
            active={selectedCircleId === null}
            label="Alle Circles"
            onPress={() => setSelectedCircleId(null)}
          />
          {circles.map((circle: CircleListItem) => (
            <CircleChip
              key={circle._id}
              active={selectedCircleId === circle._id}
              label={circle.name}
              onPress={() => setSelectedCircleId(circle._id)}
            />
          ))}
          {circlesPage.status !== 'Exhausted' ? (
            <CircleChip
              active={false}
              label={circlesPage.status === 'LoadingMore' ? 'Lädt...' : 'Mehr'}
              onPress={() => circlesPage.loadMore(40)}
            />
          ) : null}
        </ScrollView>

        {mode === 'timeline' ? (
          <MonthRail
            activeFilter={activeFilter}
            months={discovery?.months ?? []}
            onClear={() => setActiveFilter(null)}
            onSelectMonth={(month) => setActiveFilter({ kind: 'month', key: month.key })}
          />
        ) : (
          <>
            {discovery?.places.length ? (
              <MemoryPlacesMap
                places={discovery.places}
                selectedPlaceKey={selectedPlaceKey}
                onSelectPlace={handleSelectPlace}
              />
            ) : null}
            <PlaceRail
              activePlaceKey={selectedPlaceKey}
              places={discovery?.places ?? []}
              onClear={() => setActiveFilter(null)}
              onSelectPlace={handleSelectPlace}
            />
          </>
        )}

        {!hasViewer || isLoadingFirstPage ? (
          <View style={styles.loadingState}>
            {isLoadingFirstPage ? (
              <ActivityIndicator size="large" color={theme.primary} />
            ) : (
              <LoadingBox />
            )}
          </View>
        ) : memories.length === 0 ? (
          <EmptyState
            icon={mode === 'places' ? 'map-outline' : 'images-outline'}
            title={mode === 'places' ? 'Keine Orte' : 'Keine Erinnerungen'}
            message={
              mode === 'places'
                ? 'Veröffentlichte Medien mit Standort erscheinen hier auf der Karte.'
                : 'Veröffentlichte Fotos und Videos erscheinen hier nach ihrem Aufnahmedatum.'
            }
          />
        ) : (
          <View style={styles.sections}>
            {sections.map((section) => (
              <View key={section.key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    {section.title}
                  </Text>
                  <Text style={[styles.sectionCount, { color: theme.textTertiary }]}>
                    {section.items.length.toString().padStart(2, '0')}
                  </Text>
                </View>
                <View style={[styles.grid, { gap: GRID_GAP }]}>
                  {section.items.map((item) => (
                    <MemoryTile
                      key={item._id}
                      item={item}
                      size={tileSize}
                      onOpen={handleOpenMemory}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {hasViewer && memories.length > 0 && memoriesPage.status !== 'Exhausted' ? (
          <Button
            label={isLoadingMore ? 'Lädt...' : 'Mehr Erinnerungen'}
            icon="chevron-down-outline"
            variant="outline"
            loading={isLoadingMore}
            disabled={isLoadingMore}
            onPress={() => memoriesPage.loadMore(48)}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: Spacing.xs,
    borderRadius: Radius.full,
    padding: 4,
  },
  modeButton: {
    minHeight: 38,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.full,
  },
  modeButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  filters: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  filterChip: {
    minHeight: 38,
    maxWidth: 220,
    borderWidth: 1,
    borderRadius: Radius.full,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  filterChipText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  loadingState: {
    paddingVertical: Spacing['4xl'],
  },
  sections: {
    gap: Spacing.xl,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  sectionCount: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
