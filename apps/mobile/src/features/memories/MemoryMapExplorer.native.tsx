import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Num, Plural, T } from 'gt-react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import type { MemoryMapItem } from '@/features/convex/api';
import { useSignedAssetUrl } from '@/features/media/use-signed-asset-url';
import { MemoryTile } from '@/features/memories/MemoryTile';
import {
  bucketedZoomDelta,
  clusterMapItems,
  isWithinRegion,
  regionForItems,
  zoomedRegionForCluster,
  type MapCluster,
  type MapRegion,
} from '@/features/memories/map-clustering';
import { MotionDuration, motionEasing } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

const FALLBACK_REGION: MapRegion = {
  latitude: 51.1657,
  longitude: 10.4515,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

const SHEET_GRID_GAP = 6;
const SHEET_GRID_COLUMNS = 3;
const ZOOM_ANIMATION_MS = 350;
/** How long a marker keeps repainting after its cluster count changed. */
const MARKER_REPAINT_MS = 600;

interface MemoryMapExplorerProps {
  items: MemoryMapItem[] | undefined;
  onOpenMemory: (item: MemoryMapItem) => void;
}

export const MemoryMapExplorer = memo(function MemoryMapExplorer({
  items,
  onOpenMemory,
}: MemoryMapExplorerProps) {
  const theme = useTheme();
  const mapRef = useRef<MapView>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [region, setRegion] = useState<MapRegion | null>(null);

  const located = useMemo(() => items ?? [], [items]);
  const initialRegion = useMemo(
    () => regionForItems(located, FALLBACK_REGION),
    // Frame the first data set once; later pans must not re-anchor the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [located.length > 0],
  );
  const effectiveRegion = region ?? initialRegion;

  // Cluster on the zoom bucket only — panning keeps clusters (and their
  // mounted markers) untouched, so thumbnails never flicker mid-pan.
  const zoomLatDelta = bucketedZoomDelta(effectiveRegion.latitudeDelta);
  const zoomLngDelta = bucketedZoomDelta(effectiveRegion.longitudeDelta);
  const clusters = useMemo(
    () =>
      clusterMapItems(
        located,
        { latitudeDelta: zoomLatDelta, longitudeDelta: zoomLngDelta },
        layout,
      ),
    [layout, located, zoomLatDelta, zoomLngDelta],
  );
  // Only what the current map cutout shows ends up in the sheet.
  const visibleItems = useMemo(
    () => located.filter((item) => isWithinRegion(item, effectiveRegion)),
    [effectiveRegion, located],
  );

  const handleClusterPress = useCallback(
    (cluster: MapCluster<MemoryMapItem>) => {
      if (cluster.count === 1) {
        onOpenMemory(cluster.newest);
        return;
      }

      mapRef.current?.animateToRegion(
        zoomedRegionForCluster(cluster, effectiveRegion),
        ZOOM_ANIMATION_MS,
      );
    },
    [effectiveRegion, onOpenMemory],
  );

  return (
    <View
      style={styles.container}
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onRegionChangeComplete={setRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
      >
        {clusters.map((cluster) => (
          <ClusterMarker key={cluster.key} cluster={cluster} onPress={handleClusterPress} />
        ))}
      </MapView>

      {items === undefined ? (
        <View style={styles.statusOverlay} pointerEvents="none">
          <View style={[styles.statusCard, { backgroundColor: theme.surface }]}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        </View>
      ) : located.length === 0 ? (
        <View style={styles.statusOverlay} pointerEvents="none">
          <View style={[styles.statusCard, { backgroundColor: theme.surface }]}>
            <Ionicons name="map-outline" size={18} color={theme.textTertiary} />
            <T>
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                Veröffentlichte Medien mit Standort erscheinen hier auf der Karte.
              </Text>
            </T>
          </View>
        </View>
      ) : null}

      {layout.height > 0 && located.length > 0 ? (
        <MapMemorySheet
          items={visibleItems}
          containerHeight={layout.height}
          onOpenMemory={onOpenMemory}
        />
      ) : null}
    </View>
  );
});

const ClusterMarker = memo(function ClusterMarker({
  cluster,
  onPress,
}: {
  cluster: MapCluster<MemoryMapItem>;
  onPress: (cluster: MapCluster<MemoryMapItem>) => void;
}) {
  const theme = useTheme();
  const signedUrl = useSignedAssetUrl(cluster.newest.assetId, 'preview');
  const [isImageReady, setIsImageReady] = useState(false);
  const [isRepainting, setIsRepainting] = useState(false);
  const lastCount = useRef(cluster.count);

  // Frozen markers (tracksViewChanges=false) never repaint natively — wake
  // the marker up briefly whenever its count badge changes across zooms.
  useEffect(() => {
    if (lastCount.current === cluster.count) {
      return;
    }

    lastCount.current = cluster.count;
    setIsRepainting(true);
    const timer = setTimeout(() => setIsRepainting(false), MARKER_REPAINT_MS);

    return () => clearTimeout(timer);
  }, [cluster.count]);

  return (
    <Marker
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={!isImageReady || isRepainting}
      onPress={() => onPress(cluster)}
    >
      <View style={[styles.markerFrame, { backgroundColor: theme.surface }]}>
        {signedUrl ? (
          <Image
            source={{ uri: signedUrl }}
            style={styles.markerImage}
            onLoadEnd={() => setIsImageReady(true)}
          />
        ) : (
          <View style={styles.markerFallback}>
            <Ionicons
              name={cluster.newest.kind === 'video' ? 'play' : 'image-outline'}
              size={18}
              color={theme.textTertiary}
            />
          </View>
        )}
        {cluster.count > 1 ? (
          <View style={[styles.markerBadge, { backgroundColor: theme.primary }]}>
            <Text allowFontScaling={false} style={[styles.markerBadgeText, { color: theme.primaryText }]}>
              {cluster.count > 99 ? '99+' : cluster.count}
            </Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
});

function MapMemorySheet({
  items,
  containerHeight,
  onOpenMemory,
}: {
  items: MemoryMapItem[];
  containerHeight: number;
  onOpenMemory: (item: MemoryMapItem) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const sheetHeight = Math.round(containerHeight * 0.86);
  const halfOffset = sheetHeight - Math.round(containerHeight * 0.45);
  const hiddenOffset = sheetHeight;
  const translateY = useSharedValue(hiddenOffset);
  const dragStartY = useRef(hiddenOffset);
  // Closed by default: the map stays clean, only the count pill floats above it.
  const [isOpen, setIsOpen] = useState(false);

  const snapTo = useCallback(
    (offset: number) => {
      translateY.value = withTiming(offset, {
        duration: MotionDuration.base,
        easing: motionEasing,
        reduceMotion: ReduceMotion.System,
      });
      dragStartY.current = offset;
      setIsOpen(offset < hiddenOffset);
    },
    [hiddenOffset, translateY],
  );

  const dragHandlers = useMemo(() => {
    const begin = () => {
      dragStartY.current = translateY.value;
    };
    const move = (dy: number) => {
      translateY.value = Math.min(Math.max(dragStartY.current + dy, 0), hiddenOffset);
    };
    const release = (dy: number, vy: number) => {
      const projected = dragStartY.current + dy + vy * 160;
      const snapPoints = [0, halfOffset, hiddenOffset];
      let target = snapPoints[0]!;

      for (const point of snapPoints) {
        if (Math.abs(point - projected) < Math.abs(target - projected)) {
          target = point;
        }
      }

      snapTo(target);
    };

    return { begin, move, release };
  }, [halfOffset, hiddenOffset, snapTo, translateY]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: dragHandlers.begin,
        onPanResponderMove: (_event, gesture) => dragHandlers.move(gesture.dy),
        onPanResponderRelease: (_event, gesture) =>
          dragHandlers.release(gesture.dy, gesture.vy),
      }),
    [dragHandlers],
  );

  // The pill can be pulled upward, not just tapped: vertical movement is
  // captured for dragging while plain taps still reach the Pressable.
  const pillPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: dragHandlers.begin,
        onPanResponderMove: (_event, gesture) => dragHandlers.move(gesture.dy),
        onPanResponderRelease: (_event, gesture) =>
          dragHandlers.release(gesture.dy, gesture.vy),
      }),
    [dragHandlers],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Fade the pill away while the sheet rises so a drag hands over seamlessly.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [halfOffset, hiddenOffset],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const tileSize = Math.floor(
    (width - Spacing.lg * 2 - SHEET_GRID_GAP * (SHEET_GRID_COLUMNS - 1)) / SHEET_GRID_COLUMNS,
  );

  return (
    <>
      <Animated.View
        style={[styles.pillWrap, pillStyle]}
        pointerEvents={isOpen ? 'none' : 'box-none'}
      >
        <View {...pillPanResponder.panHandlers}>
          <Pressable
            accessibilityRole="button"
            onPress={() => snapTo(halfOffset)}
            style={({ pressed }) => [
              styles.pill,
              {
                backgroundColor: theme.surface,
                borderColor: theme.borderLight,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-up" size={14} color={theme.textSecondary} />
            <T>
              <Text style={[styles.pillText, { color: theme.text }]}>
                <Plural
                  n={items.length}
                  one={
                    <>
                      <Num>{items.length}</Num> Erinnerung
                    </>
                  }
                  other={
                    <>
                      <Num>{items.length}</Num> Erinnerungen
                    </>
                  }
                />
              </Text>
            </T>
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            backgroundColor: theme.surface,
          },
          sheetStyle,
        ]}
      >
        <View {...sheetPanResponder.panHandlers} style={styles.sheetHandleArea}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <T>
            <Text style={[styles.sheetTitle, { color: theme.textSecondary }]}>
              <Plural
                n={items.length}
                one={
                  <>
                    <Num>{items.length}</Num> Erinnerung im Ausschnitt
                  </>
                }
                other={
                  <>
                    <Num>{items.length}</Num> Erinnerungen im Ausschnitt
                  </>
                }
              />
            </Text>
          </T>
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => item._id}
          numColumns={SHEET_GRID_COLUMNS}
          columnWrapperStyle={styles.sheetGridRow}
          contentContainerStyle={styles.sheetGrid}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <MemoryTile item={item} size={tileSize} onOpen={() => onOpenMemory(item)} />
          )}
        />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  statusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 320,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  statusText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 18,
  },
  markerFrame: {
    width: 52,
    height: 52,
    borderRadius: 14,
    padding: 2,
    ...StyleSheet.flatten({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.24,
      shadowRadius: 4,
      elevation: 4,
    }),
  },
  markerImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  markerFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerBadge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 22,
    height: 22,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  markerBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '900',
  },
  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.lg,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...StyleSheet.flatten({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.14,
      shadowRadius: 8,
      elevation: 4,
    }),
  },
  pillText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    ...StyleSheet.flatten({
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 12,
    }),
  },
  sheetHandleArea: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  grabber: {
    width: 42,
    height: 5,
    borderRadius: Radius.full,
  },
  sheetTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sheetGrid: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing['3xl'],
    gap: SHEET_GRID_GAP,
  },
  sheetGridRow: {
    gap: SHEET_GRID_GAP,
  },
});
