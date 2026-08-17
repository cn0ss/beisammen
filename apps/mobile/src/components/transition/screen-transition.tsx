import { Canvas, Circle } from '@shopify/react-native-skia';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const COVER_DURATION_MS = 430;
const HOLD_MS = 110;
const REVEAL_DURATION_MS = 300;

interface ScreenTransitionContextValue {
  /**
   * Play the Skia circle wipe: the iris covers the screen, `action` runs
   * (navigate, flip state) while covered, then the overlay reveals the new
   * screen. Falls back to running `action` immediately under reduce motion.
   */
  wipe: (action?: () => void) => void;
}

const ScreenTransitionContext = createContext<ScreenTransitionContextValue | null>(null);

const WipeOverlay = memo(function WipeOverlay({
  radius,
  opacity,
}: {
  radius: ReturnType<typeof useSharedValue<number>>;
  opacity: ReturnType<typeof useSharedValue<number>>;
}) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const cx = width / 2;
  const cy = height / 2;

  // The accent ring leads the primary fill for a layered, editorial sweep.
  const accentRadius = useDerivedValue(() => radius.value * 1.14, []);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="auto">
      <Canvas style={{ width, height }}>
        <Circle cx={cx} cy={cy} r={accentRadius} color={theme.accent} />
        <Circle cx={cx} cy={cy} r={radius} color={theme.primary} />
      </Canvas>
    </Animated.View>
  );
});

export function ScreenTransitionProvider({ children }: PropsWithChildren) {
  const { width, height } = useWindowDimensions();
  const [isActive, setIsActive] = useState(false);
  const actionRef = useRef<(() => void) | undefined>(undefined);
  const radius = useSharedValue(0);
  const opacity = useSharedValue(1);

  const maxRadius = Math.hypot(width, height) / 2 + 40;

  const finish = useCallback(() => {
    setIsActive(false);
  }, []);

  const runCoveredAction = useCallback(() => {
    actionRef.current?.();
    actionRef.current = undefined;

    setTimeout(() => {
      opacity.value = withTiming(
        0,
        { duration: REVEAL_DURATION_MS, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) {
            runOnJS(finish)();
          }
        },
      );
    }, HOLD_MS);
  }, [finish, opacity]);

  const wipe = useCallback(
    (action?: () => void) => {
      if (isActive) {
        return;
      }

      actionRef.current = action;

      void AccessibilityInfo.isReduceMotionEnabled()
        .catch(() => false)
        .then((reduceMotion) => {
          if (reduceMotion) {
            actionRef.current?.();
            actionRef.current = undefined;
            return;
          }

          radius.value = 0;
          opacity.value = 1;
          setIsActive(true);
          radius.value = withTiming(
            maxRadius,
            { duration: COVER_DURATION_MS, easing: Easing.inOut(Easing.cubic) },
            (finished) => {
              if (finished) {
                runOnJS(runCoveredAction)();
              }
            },
          );
        });
    },
    [isActive, maxRadius, opacity, radius, runCoveredAction],
  );

  const value = useMemo<ScreenTransitionContextValue>(() => ({ wipe }), [wipe]);

  return (
    <ScreenTransitionContext.Provider value={value}>
      {children}
      {isActive ? <WipeOverlay radius={radius} opacity={opacity} /> : null}
    </ScreenTransitionContext.Provider>
  );
}

export function useScreenTransition(): ScreenTransitionContextValue {
  const context = useContext(ScreenTransitionContext);

  if (!context) {
    throw new Error('useScreenTransition must be used within ScreenTransitionProvider.');
  }

  return context;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 90,
  },
});
