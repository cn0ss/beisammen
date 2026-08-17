import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { T, useGT, useLocale } from 'gt-react-native';

import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';

import { Button, EmptyState, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import type {
  CircleListItem,
  MemoryFilterArgs,
  MemoryMonthFacet,
} from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { MemoryMapExplorer } from '@/features/memories/MemoryMapExplorer';
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

const PickerRow = memo(function PickerRow({
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
        styles.pickerRow,
        { backgroundColor: pressed ? theme.surfacePressed : 'transparent' },
      ]}
    >
      <Text
        style={[
          styles.pickerRowLabel,
          { color: active ? theme.primary : theme.text },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {active ? <Ionicons name="checkmark" size={16} color={theme.primary} /> : null}
    </Pressable>
  );
});

const MapToggleButton = memo(function MapToggleButton({
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
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mapToggleButton,
        {
          backgroundColor: active ? theme.primary : 'transparent',
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? theme.primaryText : theme.textSecondary} />
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
  const gt = useGT();
  const locale = useLocale();

  if (months.length === 0) {
    return null;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      <CircleChip active={!activeFilter} label={gt('Alle Monate')} onPress={onClear} />
      {months.map((month) => (
        <CircleChip
          key={month.key}
          active={activeFilter?.kind === 'month' && activeFilter.key === month.key}
          label={`${formatMemoryMonthFacetTitle(month.key, locale)} · ${month.itemCount}`}
          onPress={() => onSelectMonth(month)}
        />
      ))}
    </ScrollView>
  );
}

export default function MemoriesScreen() {
  const router = useRouter();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const gt = useGT();
  const locale = useLocale();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Shared with Home and persisted across restarts; null means "Alle Circles".
  const { activeCircleId: selectedCircleId, setActiveCircleId: setSelectedCircleId } =
    useSession();
  const [mode, setMode] = useState<MemoryMode>('timeline');
  const [activeFilter, setActiveFilter] = useState<MemoryFilterArgs | null>(null);
  const [isCirclePickerOpen, setIsCirclePickerOpen] = useState(false);
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
    hasViewer && mode === 'timeline'
      ? {
          ...(selectedCircleId ? { circleId: selectedCircleId } : {}),
          ...(queryFilter ? { filter: queryFilter } : {}),
        }
      : 'skip',
    { initialNumItems: 48 },
  );
  const locatedItems = useQuery(
    api.memories.locatedForViewer,
    hasViewer && mode === 'places'
      ? selectedCircleId
        ? { circleId: selectedCircleId }
        : {}
      : 'skip',
  );
  const memories = hasViewer && mode === 'timeline' ? memoriesPage.results : [];
  const sections = useMemo(() => buildMemoryMonthSections(memories, locale), [locale, memories]);
  const isLoadingFirstPage = hasViewer && memoriesPage.status === 'LoadingFirstPage';
  const isLoadingMore = memoriesPage.status === 'LoadingMore';
  const contentWidth = Math.min(width, MaxContentWidth) - Spacing.lg * 2;
  const tileSize = Math.floor((contentWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);

  useEffect(() => {
    // The selection is shared and persisted — only clear it once the full
    // circle list confirms the circle is really gone (left or deleted).
    if (
      selectedCircleId &&
      circlesPage.status === 'Exhausted' &&
      !circles.some((circle) => circle._id === selectedCircleId)
    ) {
      setSelectedCircleId(null);
    }
  }, [circles, circlesPage.status, selectedCircleId, setSelectedCircleId]);

  useEffect(() => {
    setActiveFilter(null);
  }, [selectedCircleId]);

  const handleOpenMemory = (item: { _id: string }) => {
    router.push(
      buildMemoryViewerHref({
        memoryId: item._id,
        circleId: selectedCircleId,
        filter: mode === 'timeline' ? activeFilter : null,
      }) as never,
    );
  };

  const modeSwitchNode = (
    <View style={[styles.modeSwitch, { backgroundColor: theme.surface }]}>
      <ModeButton
        active={mode === 'timeline'}
        icon="calendar-outline"
        label={gt('Zeitleiste')}
        onPress={() => {
          setMode('timeline');
          if (activeFilter?.kind === 'place') setActiveFilter(null);
        }}
      />
      <ModeButton
        active={mode === 'places'}
        icon="map-outline"
        label={gt('Karte')}
        onPress={() => {
          setMode('places');
          setActiveFilter(null);
        }}
      />
    </View>
  );

  const circleChipsNode = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      <CircleChip
        active={selectedCircleId === null}
        label={gt('Alle Circles')}
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
          label={circlesPage.status === 'LoadingMore' ? gt('Lädt...') : gt('Mehr')}
          onPress={() => circlesPage.loadMore(40)}
        />
      ) : null}
    </ScrollView>
  );

  if (mode === 'places') {
    // Snapchat-style full-bleed map: one quiet control row floats on top, the
    // memory grid lives in the swipe-up sheet inside the explorer.
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.mapContainer}>
          <MemoryMapExplorer items={locatedItems} onOpenMemory={handleOpenMemory} />
          <View style={styles.mapOverlay} pointerEvents="box-none">
            <View
              style={[
                styles.mapToggle,
                { backgroundColor: theme.surface, borderColor: theme.borderLight },
              ]}
            >
              <MapToggleButton
                active={false}
                icon="calendar-outline"
                label={gt('Zeitleiste')}
                onPress={() => {
                  setMode('timeline');
                  setActiveFilter(null);
                }}
              />
              <MapToggleButton active icon="map" label={gt('Karte')} onPress={() => {}} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt('Circle wählen')}
              onPress={() => setIsCirclePickerOpen(true)}
              style={({ pressed }) => [
                styles.mapFilterButton,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.borderLight,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="people-outline" size={14} color={theme.textSecondary} />
              <Text
                style={[styles.mapFilterLabel, { color: theme.text }]}
                numberOfLines={1}
              >
                {selectedCircleId
                  ? (circles.find((circle) => circle._id === selectedCircleId)?.name ??
                    gt('Circle'))
                  : gt('Alle Circles')}
              </Text>
              <Ionicons name="chevron-down" size={13} color={theme.textTertiary} />
            </Pressable>
          </View>

          <Modal
            visible={isCirclePickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setIsCirclePickerOpen(false)}
          >
            <Pressable style={styles.pickerBackdrop} onPress={() => setIsCirclePickerOpen(false)}>
              <View
                style={[
                  styles.pickerCard,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.borderLight,
                    top: insets.top + 58,
                  },
                ]}
                // Keep taps inside the card from closing the backdrop.
                onStartShouldSetResponder={() => true}
              >
                <ScrollView showsVerticalScrollIndicator={false}>
                  <PickerRow
                    active={selectedCircleId === null}
                    label={gt('Alle Circles')}
                    onPress={() => {
                      setSelectedCircleId(null);
                      setIsCirclePickerOpen(false);
                    }}
                  />
                  {circles.map((circle: CircleListItem) => (
                    <PickerRow
                      key={circle._id}
                      active={selectedCircleId === circle._id}
                      label={circle.name}
                      onPress={() => {
                        setSelectedCircleId(circle._id);
                        setIsCirclePickerOpen(false);
                      }}
                    />
                  ))}
                  {circlesPage.status !== 'Exhausted' ? (
                    <PickerRow
                      active={false}
                      label={circlesPage.status === 'LoadingMore' ? gt('Lädt...') : gt('Mehr laden')}
                      onPress={() => circlesPage.loadMore(40)}
                    />
                  ) : null}
                </ScrollView>
              </View>
            </Pressable>
          </Modal>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enterSection(0)} style={styles.header}>
          <T>
            <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Archiv</Text>
            <Text style={[styles.title, { color: theme.text }]}>Erinnerungen</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Fotos und Videos nach Zeit und Ort entdecken.
            </Text>
          </T>
        </Animated.View>

        {modeSwitchNode}

        {circleChipsNode}

        <MonthRail
          activeFilter={activeFilter}
          months={discovery?.months ?? []}
          onClear={() => setActiveFilter(null)}
          onSelectMonth={(month) => setActiveFilter({ kind: 'month', key: month.key })}
        />

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
            icon="images-outline"
            title={gt('Keine Erinnerungen')}
            message={gt('Veröffentlichte Fotos und Videos erscheinen hier nach ihrem Aufnahmedatum.')}
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
            label={isLoadingMore ? gt('Lädt...') : gt('Mehr Erinnerungen')}
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
  mapContainer: {
    flex: 1,
  },
  mapOverlay: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  mapToggle: {
    flexDirection: 'row',
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    padding: 3,
    ...{
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 3,
    },
  },
  mapToggleButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 38,
    maxWidth: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    ...{
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 3,
    },
  },
  mapFilterLabel: {
    flexShrink: 1,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  pickerCard: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    maxHeight: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xs,
    ...{
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 20,
      elevation: 10,
    },
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
  },
  pickerRowLabel: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
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
