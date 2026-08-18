import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { T, useGT } from 'gt-react-native';

import { useAction, useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';
import { useEvent } from 'expo';
import { VideoView, type VideoPlayer } from 'expo-video';

import {
  AnimatedPressable,
  FeedbackToast,
  LoadingBox,
  MediaLoadingIndicator,
} from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { MemoryFilterArgs, MemoryItemRecord } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { useCircleKeys } from '@/features/crypto/use-circle-keys';
import { buildShareDetailHref } from '@/features/engagement/navigation';
import {
  downloadAssetToCache,
  formatMediaLocation,
  saveAssetToDeviceLibrary,
  shareLocalFile,
} from '@/features/media/client';
import { useAssetMediaUri } from '@/features/media/use-asset-media-uri';
import { isVideoProxyUrl } from '@/features/media/video-proxy/server';
import { useLivePhotoPlayback } from '@/features/media/use-live-photo-playback';
import { useVideoPlayerSource } from '@/features/media/use-video-player-source';
import { useDecryptedAssetLocation } from '@/features/media/use-decrypted-asset-location';
import { normalizeMemoryFilter } from '@/features/memories/timeline';
import { enterScreen, exitFade } from '@/lib/motion';
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

/** Soft black gradient behind the chrome so text and icons stay readable on any photo. */
function Scrim({ edge, height }: { edge: 'top' | 'bottom'; height: number }) {
  const id = `scrim-${edge}`;

  return (
    <Svg
      pointerEvents="none"
      style={[styles.scrim, edge === 'top' ? styles.scrimTop : styles.scrimBottom, { height }]}
    >
      <Defs>
        <LinearGradient
          id={id}
          x1="0"
          x2="0"
          y1={edge === 'top' ? '0' : '1'}
          y2={edge === 'top' ? '1' : '0'}
        >
          <Stop offset="0" stopColor="#000000" stopOpacity="0.88" />
          <Stop offset="0.3" stopColor="#000000" stopOpacity="0.72" />
          <Stop offset="0.55" stopColor="#000000" stopOpacity="0.45" />
          <Stop offset="0.78" stopColor="#000000" stopOpacity="0.2" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** Instagram-style page dots with a sliding window for long timelines. */
function PageDots({ count, index }: { count: number; index: number }) {
  const MAX_DOTS = 7;

  if (count <= 1) {
    return null;
  }

  const visible = Math.min(count, MAX_DOTS);
  const start = count > MAX_DOTS ? Math.min(Math.max(index - 3, 0), count - MAX_DOTS) : 0;

  return (
    <View style={styles.dotsRow} pointerEvents="none">
      {Array.from({ length: visible }, (_, i) => {
        const dotIndex = start + i;
        const isActive = dotIndex === index;
        const isEdge =
          count > MAX_DOTS &&
          ((i === 0 && start > 0) || (i === visible - 1 && start + visible < count));

        return (
          <View
            key={dotIndex}
            style={[styles.dot, isEdge && styles.dotSmall, isActive && styles.dotActive]}
          />
        );
      })}
    </View>
  );
}

/** Round overlay action (save / share / conversation) with a small label underneath. */
function ViewerAction({
  emphasized = false,
  icon,
  label,
  loading = false,
  onPress,
}: {
  emphasized?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const iconColor = emphasized ? '#111113' : '#FFFFFF';

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={loading}
      onPress={onPress}
      pressedScale={0.94}
      style={styles.action}
    >
      <View style={[styles.actionCircle, emphasized && styles.actionCircleEmphasized]}>
        {loading ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Ionicons name={icon} size={22} color={iconColor} />
        )}
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

function formatPlaybackTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;

  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * Play/pause and a scrubbable progress bar for the active video. Replaces the
 * native player UI so playback controls live in the chrome and hide with it.
 */
function VideoControls({ player }: { player: VideoPlayer }) {
  const gt = useGT();
  const [trackWidth, setTrackWidth] = useState(0);
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);
  const isScrubbing = useRef(false);

  // Native players can be released during fast swipes; every property read
  // throws once the native object is gone, so read them all defensively.
  let initialIsPlaying = false;
  let initialCurrentTime = 0;
  let duration = 0;
  try {
    initialIsPlaying = player.playing;
    initialCurrentTime = player.currentTime;
    duration = player.duration;
  } catch {
    // Released mid-render; the stale values only survive one frame.
  }

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: initialIsPlaying });
  const timeUpdate = useEvent(player, 'timeUpdate', {
    currentTime: initialCurrentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  // A committed seek keeps showing the target position until playback reports
  // a fresh time; while paused no updates arrive and the target stays put.
  useEffect(() => {
    if (!isScrubbing.current) {
      setScrubFraction(null);
    }
  }, [timeUpdate.currentTime]);

  const fraction =
    scrubFraction ??
    (duration > 0 ? Math.min(Math.max(timeUpdate.currentTime / duration, 0), 1) : 0);
  const bufferedFraction =
    duration > 0 ? Math.min(Math.max(timeUpdate.bufferedPosition / duration, 0), 1) : 0;
  const displayTime = scrubFraction !== null ? scrubFraction * duration : timeUpdate.currentTime;

  const togglePlayback = () => {
    try {
      if (player.playing) {
        player.pause();
      } else if (duration > 0 && player.currentTime >= duration - 0.1) {
        player.replay();
      } else {
        player.play();
      }
    } catch {
      // Native players can be released during fast swipes.
    }
  };

  const fractionForX = (x: number) =>
    trackWidth > 0 ? Math.min(Math.max(x / trackWidth, 0), 1) : 0;

  // minDistance(0) claims the touch immediately so dragging the scrubber never
  // starts a page swipe in the surrounding pager.
  const scrubGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((event) => {
      isScrubbing.current = true;
      setScrubFraction(fractionForX(event.x));
    })
    .onUpdate((event) => {
      setScrubFraction(fractionForX(event.x));
    })
    .onFinalize((event) => {
      const target = fractionForX(event.x);
      setScrubFraction(target);
      isScrubbing.current = false;

      try {
        if (duration > 0) {
          player.currentTime = target * duration;
        }
      } catch {
        // Native players can be released during fast swipes.
      }
    });

  return (
    <View style={styles.videoControls}>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? gt('Pausieren') : gt('Abspielen')}
        hitSlop={8}
        onPress={togglePlayback}
        pressedScale={0.94}
        style={styles.playButton}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" />
      </AnimatedPressable>

      <Text style={styles.timeLabel}>{formatPlaybackTime(displayTime)}</Text>

      <GestureDetector gesture={scrubGesture}>
        <View
          style={styles.trackTouchArea}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        >
          <View style={styles.track}>
            <View style={[styles.trackBuffered, { width: `${bufferedFraction * 100}%` }]} />
            <View style={[styles.trackFill, { width: `${fraction * 100}%` }]} />
          </View>
          {trackWidth > 0 ? (
            <View style={[styles.trackKnob, { left: fraction * (trackWidth - 12) }]} />
          ) : null}
        </View>
      </GestureDetector>

      <Text style={styles.timeLabel}>{formatPlaybackTime(duration)}</Text>
    </View>
  );
}

function MemoryViewerSlide({
  height,
  isActive,
  isFocused,
  item,
  onPlayerActive,
  onPlayerInactive,
  onToggleChrome,
  width,
}: {
  height: number;
  isActive: boolean;
  isFocused: boolean;
  item: MemoryItemRecord;
  onPlayerActive: (player: VideoPlayer) => void;
  onPlayerInactive: (player: VideoPlayer) => void;
  onToggleChrome: () => void;
  width: number;
}) {
  // Encrypted videos stream through the local range-decrypting proxy (or a
  // cached decrypted file); images resolve via the decrypted cache.
  const signedUrl = useAssetMediaUri(item.asset, 'original', item.circleId);
  // The preview variant is usually already in the decrypted cache from the
  // timeline grid; it doubles as an instant poster while the original loads.
  const previewUrl = useAssetMediaUri(item.asset, 'preview', item.circleId);
  const { player, isSourceReady, hasFirstFrame, playerStatus, onFirstFrameRender } =
    useVideoPlayerSource({
      assetId: item.assetId,
      kind: item.kind,
      signedUrl,
      setup: (instance) => {
        // The chrome's scrubber needs frequent position updates.
        instance.timeUpdateEventInterval = 0.25;
      },
    });
  const livePhoto = useLivePhotoPlayback({
    asset: item.asset,
    circleId: item.circleId,
    prefetch: isActive && isFocused && item.kind === 'image',
  });
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  // The chrome hosts the playback controls for whichever slide is active.
  useEffect(() => {
    if (item.kind !== 'video' || !isActive || !isSourceReady) {
      return;
    }

    onPlayerActive(player);

    return () => onPlayerInactive(player);
  }, [isActive, isSourceReady, item.kind, onPlayerActive, onPlayerInactive, player]);

  useEffect(() => {
    if (item.kind !== 'video' || !isSourceReady) {
      return;
    }

    try {
      if (isActive && isFocused) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Native players can be released during fast swipes.
    }
  }, [isActive, isFocused, isSourceReady, item.kind, player]);

  if (item.kind === 'video') {
    // Loading covers the whole path to moving pictures (URL resolution,
    // source load, initial buffer) plus later rebuffers, which flip the
    // player status back to 'loading' mid-playback.
    const isLoading = !hasFirstFrame || playerStatus === 'loading';

    // No native controls: playback UI lives in the chrome (VideoControls), so
    // a tap on the video toggles the chrome exactly like on photos.
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onToggleChrome}
        style={[styles.slide, { height, width }]}
      >
        {signedUrl ? (
          <VideoView
            player={player}
            style={styles.media}
            nativeControls={false}
            contentFit="contain"
            onFirstFrameRender={onFirstFrameRender}
          />
        ) : null}

        {/* Poster: the cached preview shows instantly and crossfades away on
            the first decoded frame. */}
        {!hasFirstFrame && previewUrl ? (
          <Animated.View exiting={exitFade()} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: previewUrl }} style={styles.media} contentFit="contain" />
          </Animated.View>
        ) : null}

        <MediaLoadingIndicator visible={isLoading} />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="imagebutton"
      onPress={onToggleChrome}
      // Press-and-hold plays a Live Photo's companion clip; a plain tap still
      // toggles the chrome (a fired long press suppresses onPress).
      delayLongPress={220}
      onLongPress={livePhoto.isLivePhoto ? livePhoto.start : undefined}
      onPressOut={livePhoto.isLivePhoto ? livePhoto.stop : undefined}
      style={[styles.slide, { height, width }]}
    >
      {!isImageLoaded && previewUrl ? (
        <View style={StyleSheet.absoluteFill}>
          <Image source={{ uri: previewUrl }} style={styles.media} contentFit="contain" />
        </View>
      ) : null}

      {signedUrl ? (
        <Image
          source={{ uri: signedUrl }}
          style={styles.media}
          contentFit="contain"
          onLoad={() => setIsImageLoaded(true)}
        />
      ) : null}

      {livePhoto.isPlaying ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <VideoView
            player={livePhoto.player}
            style={styles.media}
            nativeControls={false}
            contentFit="contain"
          />
        </View>
      ) : null}

      {!signedUrl && !previewUrl ? (
        <View style={styles.fallback}>
          <Ionicons name="image-outline" size={38} color="rgba(255,255,255,0.6)" />
        </View>
      ) : null}

      <MediaLoadingIndicator visible={!isImageLoaded || livePhoto.isLoading} />
    </Pressable>
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
  const gt = useGT();
  const insets = useSafeAreaInsets();
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
  const [activeVideoPlayer, setActiveVideoPlayer] = useState<VideoPlayer | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const getReadUrl = useAction(api.assets.getReadUrl);
  const activeItem = memories[activeIndex] ?? memories[0] ?? null;
  const activeUrl = useAssetMediaUri(activeItem?.asset, 'original', activeItem?.circleId);
  // Save/share need the circle keys to decrypt encrypted assets imperatively.
  const activeCircleKeys = useCircleKeys(
    activeItem?.asset.encryption ? activeItem.circleId : null,
  );
  const activeDecryptedLocation = useDecryptedAssetLocation({
    assetId: activeItem?.assetId,
    encryption: activeItem?.asset.encryption,
    circleId: activeItem?.circleId,
  });
  const activeLocationLabel = activeItem
    ? (activeItem.placeLabel ??
      formatMediaLocation(activeItem.location ?? activeDecryptedLocation ?? undefined))
    : null;
  const viewerDateFormat = useDateFormat(VIEWER_DATE_FORMAT_OPTIONS);

  useEffect(() => {
    if (!memoryId || memories.length === 0) {
      return;
    }

    // Timeline tiles pass the memory item id; map items are built client-side
    // from assets and pass the asset id instead — match either.
    const index = memories.findIndex(
      (item) => item._id === memoryId || item.assetId === memoryId,
    );

    if (index >= 0) {
      setActiveIndex(index);
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
      });
    }
  }, [memories, memoryId]);

  const downloadActiveItem = useCallback(async () => {
    if (!activeItem) {
      throw new Error(gt('Erinnerung ist noch nicht geladen.'));
    }

    // The local video proxy serves plaintext; the download path decrypts
    // itself, so it needs the real signed ciphertext URL instead.
    const signed =
      activeUrl && !isVideoProxyUrl(activeUrl)
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
        encryption: activeItem.asset.encryption,
      },
      url: signed.url,
      ...(activeCircleKeys.status === 'ready'
        ? { keysByEpoch: activeCircleKeys.keysByEpoch }
        : {}),
    });
  }, [activeCircleKeys, activeItem, activeUrl, getReadUrl, gt]);

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

  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => !visible);
  }, []);

  const handlePlayerActive = useCallback((player: VideoPlayer) => {
    setActiveVideoPlayer(player);
  }, []);

  const handlePlayerInactive = useCallback((player: VideoPlayer) => {
    setActiveVideoPlayer((current) => (current === player ? null : current));
  }, []);

  const renderSlide = useCallback(
    ({ index, item }: { index: number; item: MemoryItemRecord }) => (
      <MemoryViewerSlide
        item={item}
        width={width}
        height={height}
        isFocused={isFocused}
        isActive={index === activeIndex}
        onPlayerActive={handlePlayerActive}
        onPlayerInactive={handlePlayerInactive}
        onToggleChrome={toggleChrome}
      />
    ),
    [activeIndex, handlePlayerActive, handlePlayerInactive, height, isFocused, toggleChrome, width],
  );

  if (!hasViewer || (hasViewer && memoriesPage.status === 'LoadingFirstPage')) {
    return <LoadingBox />;
  }

  return (
    <View style={styles.root}>
      {memories.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={42} color="rgba(255,255,255,0.4)" />
          <T>
            <Text style={styles.emptyTitle}>Keine Medien</Text>
          </T>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={memories}
          keyExtractor={(item) => item._id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({ offset: width * index, animated: false });
          }}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
            setActiveIndex(Math.max(0, Math.min(nextIndex, memories.length - 1)));
          }}
          onEndReached={() => {
            if (memoriesPage.status !== 'Exhausted' && memoriesPage.status !== 'LoadingMore') {
              memoriesPage.loadMore(48);
            }
          }}
          renderItem={renderSlide}
        />
      )}

      {chromeVisible ? (
        <Animated.View
          entering={enterScreen()}
          exiting={exitFade()}
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
        >
          <Scrim edge="top" height={insets.top + 112} />
          <Scrim edge="bottom" height={insets.bottom + 320} />

          <View style={[styles.topBar, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={gt('Zurück')}
              hitSlop={8}
              onPress={() => router.back()}
              pressedScale={0.94}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </AnimatedPressable>

            <View style={styles.topCopy} pointerEvents="none">
              <T>
                <Text style={styles.topTitle} numberOfLines={1}>
                  Erinnerungen
                </Text>
              </T>
              {activeItem?.circleName ? (
                <Text style={styles.topMeta} numberOfLines={1}>
                  {activeItem.circleName}
                </Text>
              ) : null}
            </View>

            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={gt('Oberfläche ausblenden')}
              hitSlop={8}
              onPress={toggleChrome}
              pressedScale={0.94}
              style={styles.backButton}
            >
              <Ionicons name="eye-off-outline" size={20} color="#FFFFFF" />
            </AnimatedPressable>
          </View>

          {activeItem ? (
            <View
              style={[styles.bottomChrome, { bottom: insets.bottom + Spacing.lg }]}
              pointerEvents="box-none"
            >
              <View style={styles.captionBlock} pointerEvents="none">
                {activeItem.caption ? (
                  <Text style={styles.captionLine} numberOfLines={3}>
                    {activeItem.caption}
                  </Text>
                ) : null}
                <Text style={styles.metaLine} numberOfLines={1}>
                  {[
                    formatDate(activeItem.capturedAt ?? activeItem.timelineAt, viewerDateFormat),
                    activeLocationLabel,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>

              {activeItem.kind === 'video' && activeVideoPlayer ? (
                <VideoControls player={activeVideoPlayer} />
              ) : null}

              <PageDots count={memories.length} index={activeIndex} />

              <View style={styles.actionRow}>
                <ViewerAction
                  emphasized
                  icon="download-outline"
                  label={gt('Speichern')}
                  loading={isSaving}
                  onPress={() => {
                    void handleSave();
                  }}
                />
                <ViewerAction
                  icon="share-social-outline"
                  label={gt('Teilen')}
                  loading={isSharing}
                  onPress={() => {
                    void handleShare();
                  }}
                />
                <ViewerAction
                  icon="chatbubble-ellipses-outline"
                  label={gt('Gespräch')}
                  onPress={handleOpenConversation}
                />
              </View>
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      <View
        style={[styles.toastSlot, { top: insets.top + 64 }]}
        pointerEvents={feedback ? 'auto' : 'none'}
      >
        <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050505',
  },
  slide: {
    backgroundColor: '#050505',
  },
  media: {
    flex: 1,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
  },
  scrimTop: {
    top: 0,
  },
  scrimBottom: {
    bottom: 0,
  },
  topBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
  topCopy: {
    flex: 1,
    minWidth: 0,
  },
  topTitle: {
    color: '#FFFFFF',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  topMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: FontSize.sm,
    fontWeight: '500',
    marginTop: 1,
  },
  bottomChrome: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    gap: Spacing.lg,
  },
  captionBlock: {
    gap: 6,
    paddingRight: Spacing.xl,
  },
  captionLine: {
    color: '#FFFFFF',
    fontSize: FontSize.base,
    lineHeight: 22,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  metaLine: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: FontSize.sm,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  videoControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  timeLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '600',
    minWidth: 34,
    textAlign: 'center',
  },
  trackTouchArea: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  trackBuffered: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  trackFill: {
    height: '100%',
    borderRadius: Radius.full,
    backgroundColor: '#FFFFFF',
  },
  trackKnob: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: Radius.full,
    backgroundColor: '#FFFFFF',
  },
  dotsRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotSmall: {
    width: 4,
    height: 4,
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  action: {
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 72,
  },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  actionCircleEmphasized: {
    backgroundColor: '#FFFFFF',
  },
  actionLabel: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    fontWeight: '600',
  },
  toastSlot: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
});
