import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { T, useGT } from 'gt-react-native';

import { useAction, useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';
import { VideoView, useVideoPlayer } from 'expo-video';

import { Button, FeedbackToast, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { MemoryFilterArgs, MemoryItemRecord, ShareAssetRecord } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { buildShareDetailHref } from '@/features/engagement/navigation';
import {
  downloadAssetToCache,
  formatBytes,
  formatMediaLocation,
  saveAssetToDeviceLibrary,
  shareLocalFile,
} from '@/features/media/client';
import { useSignedAssetUrl } from '@/features/media/use-signed-asset-url';
import { normalizeMemoryFilter } from '@/features/memories/timeline';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

const VIEWER_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilter(kind?: string, key?: string): MemoryFilterArgs | null {
  if ((kind !== 'month' && kind !== 'place') || !key) {
    return null;
  }

  return normalizeMemoryFilter({ kind, key });
}

function formatDate(timestamp: number, format: Intl.DateTimeFormat) {
  return format.format(new Date(timestamp));
}

function MemoryViewerSlide({
  height,
  isActive,
  isFocused,
  item,
  width,
}: {
  height: number;
  isActive: boolean;
  isFocused: boolean;
  item: MemoryItemRecord;
  width: number;
}) {
  const theme = useTheme();
  const viewerDateFormat = useDateFormat(VIEWER_DATE_FORMAT_OPTIONS);
  const signedUrl = useSignedAssetUrl(item.assetId, 'original');
  const player = useVideoPlayer(item.kind === 'video' ? signedUrl : null, (instance) => {
    instance.pause();
  });
  const locationLabel = item.placeLabel ?? formatMediaLocation(item.location ?? undefined);

  useEffect(() => {
    if (item.kind !== 'video') {
      return;
    }

    try {
      if (isActive && isFocused && signedUrl) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Native players can be released during fast swipes.
    }
  }, [isActive, isFocused, item.kind, player, signedUrl]);

  return (
    <View style={[styles.slide, { height, width }]}>
      {item.kind === 'video' ? (
        <View style={styles.mediaFrame}>
          {signedUrl ? (
            <VideoView
              player={player}
              style={styles.media}
              nativeControls
              contentFit="contain"
            />
          ) : (
            <View style={[styles.fallback, { backgroundColor: theme.surfacePressed }]}>
              <Ionicons name="play-circle-outline" size={44} color="#FFFFFF" />
            </View>
          )}
        </View>
      ) : signedUrl ? (
        <Image source={{ uri: signedUrl }} style={styles.media} contentFit="contain" />
      ) : (
        <View style={[styles.fallback, { backgroundColor: theme.surfacePressed }]}>
          <Ionicons name="image-outline" size={38} color="#FFFFFF" />
        </View>
      )}

      <View style={styles.captionOverlay}>
        <Text style={styles.dateLine}>{formatDate(item.capturedAt ?? item.timelineAt, viewerDateFormat)}</Text>
        {locationLabel ? (
          <Text style={styles.placeLine} numberOfLines={1}>
            {locationLabel}
          </Text>
        ) : null}
        {item.caption ? (
          <Text style={styles.captionLine} numberOfLines={3}>
            {item.caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function MemoryViewerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    memoryId?: string | string[];
    circleId?: string | string[];
    filterKind?: string | string[];
    filterKey?: string | string[];
  }>();
  const theme = useTheme();
  const gt = useGT();
  const pathname = usePathname();
  const isFocused = pathname === '/memories/viewer';
  const convexAuth = useConvexAuth();
  const { height, width } = useWindowDimensions();
  const listRef = useRef<FlatList<MemoryItemRecord>>(null);
  const memoryId = firstParam(params.memoryId);
  const circleId = firstParam(params.circleId);
  const filter = parseFilter(firstParam(params.filterKind), firstParam(params.filterKey));
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const memoriesPage = usePaginatedQuery(
    api.memories.listForViewer,
    hasViewer
      ? {
          ...(circleId ? { circleId } : {}),
          ...(filter ? { filter } : {}),
        }
      : 'skip',
    { initialNumItems: 48 },
  );
  const memories = hasViewer ? memoriesPage.results : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const getReadUrl = useAction(api.assets.getReadUrl);
  const activeItem = memories[activeIndex] ?? memories[0] ?? null;
  const activeUrl = useSignedAssetUrl(activeItem?.assetId, 'original');
  const activeMeta = useMemo(() => {
    if (!activeItem) {
      return '';
    }

    return [
      activeItem.circleName,
      formatBytes(activeItem.asset.sizeBytes),
      activeItem.kind === 'video' ? gt('Video') : gt('Foto'),
    ]
      .filter(Boolean)
      .join(' · ');
  }, [activeItem, gt]);

  useEffect(() => {
    if (!memoryId || memories.length === 0) {
      return;
    }

    const index = memories.findIndex((item) => item._id === memoryId);

    if (index >= 0) {
      setActiveIndex(index);
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: false });
      });
    }
  }, [memories, memoryId]);

  const downloadActiveItem = useCallback(async () => {
    if (!activeItem) {
      throw new Error(gt('Erinnerung ist noch nicht geladen.'));
    }

    const signed =
      activeUrl
        ? { url: activeUrl }
        : await getReadUrl({ assetId: activeItem.assetId, variant: 'original' });

    if (!signed.url) {
      throw new Error(gt('Datei ist nicht mehr im Speicher vorhanden.'));
    }

    return await downloadAssetToCache({
      asset: {
        _id: activeItem.assetId,
        kind: activeItem.kind,
        fileName: activeItem.asset.fileName,
        mimeType: activeItem.asset.mimeType,
      } as ShareAssetRecord,
      url: signed.url,
    });
  }, [activeItem, activeUrl, getReadUrl, gt]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setFeedback(null);

    try {
      await saveAssetToDeviceLibrary(await downloadActiveItem());
      setFeedback(gt('Medium wurde auf dem Gerät gespeichert.'));
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Medium konnte nicht gespeichert werden.'),
      );
    } finally {
      setIsSaving(false);
    }
  }, [downloadActiveItem, gt]);

  const handleShare = useCallback(async () => {
    setIsSharing(true);
    setFeedback(null);

    try {
      await shareLocalFile(await downloadActiveItem());
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Medium konnte nicht geteilt werden.'),
      );
    } finally {
      setIsSharing(false);
    }
  }, [downloadActiveItem, gt]);

  const handleOpenConversation = useCallback(() => {
    if (!activeItem) {
      return;
    }

    router.push(
      buildShareDetailHref({
        shareBatchId: activeItem.shareBatchId,
        assetId: activeItem.assetId,
      }) as never,
    );
  }, [activeItem, router]);

  if (!hasViewer || (hasViewer && memoriesPage.status === 'LoadingFirstPage')) {
    return <LoadingBox />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: '#050505' }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt('Zurück')}
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backChevron, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.topCopy}>
          <T>
            <Text style={styles.topTitle} numberOfLines={1}>
              Erinnerungen
            </Text>
          </T>
          {activeMeta ? (
            <Text style={styles.topMeta} numberOfLines={1}>
              {activeMeta}
            </Text>
          ) : null}
        </View>
      </View>

      {memories.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={42} color={theme.textTertiary} />
          <T>
            <Text style={styles.emptyTitle}>Keine Medien</Text>
          </T>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={memories}
          keyExtractor={(item) => item._id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({
            length: height,
            offset: height * index,
            index,
          })}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.y / height);
            setActiveIndex(Math.max(0, Math.min(nextIndex, memories.length - 1)));
          }}
          onEndReached={() => {
            if (memoriesPage.status !== 'Exhausted' && memoriesPage.status !== 'LoadingMore') {
              memoriesPage.loadMore(48);
            }
          }}
          renderItem={({ index, item }) => (
            <MemoryViewerSlide
              item={item}
              width={width}
              height={height}
              isFocused={isFocused}
              isActive={index === activeIndex}
            />
          )}
        />
      )}

      <View style={styles.bottomActions}>
        {memoriesPage.status === 'LoadingMore' ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : null}
        <Button
          label={isSaving ? gt('Speichert...') : gt('Speichern')}
          icon="download-outline"
          loading={isSaving}
          onPress={() => {
            void handleSave();
          }}
        />
        <Button
          label={isSharing ? gt('Teilt...') : gt('Teilen')}
          icon="share-social-outline"
          variant="outline"
          loading={isSharing}
          onPress={() => {
            void handleShare();
          }}
        />
        <Button
          label={gt('Gespräch öffnen')}
          icon="chatbubble-ellipses-outline"
          variant="outline"
          onPress={handleOpenConversation}
        />
      </View>

      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  backChevron: {
    height: 42,
    justifyContent: 'center',
  },
  topCopy: {
    flex: 1,
    minWidth: 0,
  },
  topTitle: {
    color: '#FFFFFF',
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  topMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  slide: {
    justifyContent: 'center',
    backgroundColor: '#050505',
  },
  mediaFrame: {
    flex: 1,
    justifyContent: 'center',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionOverlay: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 156,
    gap: 4,
  },
  dateLine: {
    color: '#FFFFFF',
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  placeLine: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  captionLine: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  bottomActions: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
    zIndex: 3,
    gap: Spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
});
