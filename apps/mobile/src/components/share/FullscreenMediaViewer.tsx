import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useGT } from 'gt-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { VideoView, useVideoPlayer } from 'expo-video';

import { AnimatedPressable } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ShareAssetRecord } from '@/features/convex/api';
import { useAssetMediaUri } from '@/features/media/use-asset-media-uri';
import { MotionDuration, enterScreen, exitFade, motionEasing } from '@/lib/motion';

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

/** Zoom spring tuned like the press spring: decisive, no bounce. */
const ZOOM_SPRING = {
  damping: 26,
  stiffness: 320,
  mass: 0.8,
} as const;

/** Soft black gradient behind the chrome so icons stay readable on any photo. */
function Scrim({ height }: { height: number }) {
  return (
    <Svg pointerEvents="none" style={[styles.scrim, { height }]}>
      <Defs>
        <LinearGradient id="viewer-scrim" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.82" />
          <Stop offset="0.5" stopColor="#000000" stopOpacity="0.42" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#viewer-scrim)" />
    </Svg>
  );
}

function ZoomableImageSlide({
  height,
  isActive,
  onToggleChrome,
  onZoomChange,
  uri,
  width,
}: {
  height: number;
  isActive: boolean;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  uri: string | null;
  width: number;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [isZoomed, setIsZoomed] = useState(false);

  const reportZoom = useCallback(
    (zoomed: boolean) => {
      setIsZoomed(zoomed);
      onZoomChange(zoomed);
    },
    [onZoomChange],
  );

  // Swiping to another page resets any leftover zoom on this slide.
  useEffect(() => {
    if (!isActive) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      setIsZoomed(false);
    }
  }, [isActive, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), MAX_ZOOM);
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withTiming(1, { duration: MotionDuration.fast });
        translateX.value = withTiming(0, { duration: MotionDuration.fast });
        translateY.value = withTiming(0, { duration: MotionDuration.fast });
        runOnJS(reportZoom)(false);
      } else {
        runOnJS(reportZoom)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(isZoomed)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      // Settle back inside the visible bounds of the zoomed image.
      const maxX = (width * (scale.value - 1)) / 2;
      const maxY = (height * (scale.value - 1)) / 2;
      translateX.value = withSpring(
        Math.min(Math.max(translateX.value, -maxX), maxX),
        ZOOM_SPRING,
      );
      translateY.value = withSpring(
        Math.min(Math.max(translateY.value, -maxY), maxY),
        ZOOM_SPRING,
      );
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1, ZOOM_SPRING);
        translateX.value = withSpring(0, ZOOM_SPRING);
        translateY.value = withSpring(0, ZOOM_SPRING);
        runOnJS(reportZoom)(false);
      } else {
        scale.value = withSpring(DOUBLE_TAP_ZOOM, ZOOM_SPRING);
        runOnJS(reportZoom)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      runOnJS(onToggleChrome)();
    });

  const composed = Gesture.Simultaneous(
    Gesture.Exclusive(doubleTap, singleTap),
    pinch,
    pan,
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[{ width, height }, styles.slide]}>
        {uri ? (
          <Animated.View style={[styles.media, animatedStyle]}>
            <Image source={{ uri }} style={styles.media} contentFit="contain" />
          </Animated.View>
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="image-outline" size={38} color="rgba(255,255,255,0.6)" />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function ViewerSlide({
  asset,
  circleId,
  height,
  isActive,
  onToggleChrome,
  onZoomChange,
  width,
}: {
  asset: ShareAssetRecord;
  circleId?: string | null;
  height: number;
  isActive: boolean;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  width: number;
}) {
  const signedUrl = useAssetMediaUri(asset, 'original', circleId);
  const player = useVideoPlayer(asset.kind === 'video' ? signedUrl : null, (instance) => {
    instance.pause();
  });

  useEffect(() => {
    if (asset.kind !== 'video') {
      return;
    }

    try {
      if (isActive && signedUrl) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Native players can be released during fast swipes.
    }
  }, [asset.kind, isActive, player, signedUrl]);

  if (asset.kind === 'video') {
    return (
      <View style={[{ width, height }, styles.slide]}>
        {signedUrl ? (
          <VideoView player={player} style={styles.media} nativeControls contentFit="contain" />
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="play-circle-outline" size={44} color="rgba(255,255,255,0.6)" />
          </View>
        )}
      </View>
    );
  }

  return (
    <ZoomableImageSlide
      uri={signedUrl}
      width={width}
      height={height}
      isActive={isActive}
      onToggleChrome={onToggleChrome}
      onZoomChange={onZoomChange}
    />
  );
}

/**
 * Immersive fullscreen viewer for a share's media: swipe between assets,
 * pinch or double-tap to zoom into photos, tap to toggle the chrome.
 */
export const FullscreenMediaViewer = memo(function FullscreenMediaViewer({
  assets,
  circleId,
  initialIndex,
  onClose,
  onIndexChange,
  visible,
}: {
  assets: ShareAssetRecord[];
  circleId?: string | null;
  initialIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  visible: boolean;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const listRef = useRef<FlatList<ShareAssetRecord>>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const contentScale = useSharedValue(1);

  // iPadOS-style open: the media settles in from a slight scale-down.
  useEffect(() => {
    if (visible) {
      setActiveIndex(initialIndex);
      setChromeVisible(true);
      setIsZoomed(false);
      contentScale.value = 0.94;
      contentScale.value = withTiming(1, {
        duration: MotionDuration.base,
        easing: motionEasing,
      });
    }
    // Re-running on initialIndex alone must not replay the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentScale, visible]);

  const contentStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [{ scale: contentScale.value }],
  }));

  const toggleChrome = useCallback(() => {
    setChromeVisible((current) => !current);
  }, []);

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
  }, []);

  const handleMomentumEnd = useCallback(
    (offsetX: number) => {
      const nextIndex = Math.max(0, Math.min(Math.round(offsetX / width), assets.length - 1));
      setActiveIndex(nextIndex);
      setIsZoomed(false);
      onIndexChange(nextIndex);
    },
    [assets.length, onIndexChange, width],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      transparent={false}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={contentStyle}>
          <FlatList
            ref={listRef}
            data={assets}
            keyExtractor={(asset) => asset._id}
            horizontal
            pagingEnabled
            scrollEnabled={!isZoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onScrollToIndexFailed={({ index }) => {
              listRef.current?.scrollToOffset({ offset: width * index, animated: false });
            }}
            onMomentumScrollEnd={(event) => {
              handleMomentumEnd(event.nativeEvent.contentOffset.x);
            }}
            renderItem={({ index, item }) => (
              <ViewerSlide
                asset={item}
                circleId={circleId}
                width={width}
                height={height}
                isActive={visible && index === activeIndex}
                onToggleChrome={toggleChrome}
                onZoomChange={handleZoomChange}
              />
            )}
          />
        </Animated.View>

        {chromeVisible ? (
          <Animated.View
            entering={enterScreen()}
            exiting={exitFade()}
            pointerEvents="box-none"
            style={StyleSheet.absoluteFill}
          >
            <Scrim height={insets.top + 96} />
            <View style={[styles.topBar, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={gt('Schließen')}
                hitSlop={8}
                onPress={onClose}
                pressedScale={0.94}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </AnimatedPressable>

              {assets.length > 1 ? (
                <Text style={styles.counter} pointerEvents="none">
                  {activeIndex + 1} / {assets.length}
                </Text>
              ) : null}

              <View style={styles.topBarSpacer} />
            </View>
          </Animated.View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050505',
  },
  slide: {
    overflow: 'hidden',
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
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
  topBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
  counter: {
    color: '#FFFFFF',
    fontFamily: Fonts.mono,
    fontSize: FontSize.sm,
    fontWeight: '700',
    letterSpacing: 1,
  },
  topBarSpacer: {
    width: 40,
  },
});
