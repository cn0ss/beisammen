import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import * as SplashScreen from 'expo-splash-screen';
import { memo, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, useColorScheme } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Colors, Fonts, FontSize } from '@/constants/theme';
import { AuroraBackdrop } from '@/components/ui/skia/AuroraBackdrop';

/**
 * Timeline (~1.7s total, skipped under reduce motion):
 *   0ms    stem stroke draws in
 *   250ms  bowl stroke draws in
 *   800ms  accent dot springs in, wordmark rises
 *   1400ms overlay fades out and calls onFinish
 */
const STEM_DURATION_MS = 500;
const BOWL_DELAY_MS = 250;
const BOWL_DURATION_MS = 600;
const ACCENT_DELAY_MS = 800;
const HOLD_UNTIL_MS = 1400;
const REVEAL_DURATION_MS = 340;

const MARK_SCALE = 1.35;
const MARK_WIDTH = 110;
const MARK_HEIGHT = 130;

interface AnimatedSplashProps {
  onFinish: () => void;
}

/**
 * Branded animated splash. The native splash shows only the brand background
 * color; this overlay (same background) draws the mark in with Skia path
 * trims, pops the accent dot, raises the wordmark, then fades out to reveal
 * the app.
 */
export const AnimatedSplash = memo(function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const isDark = useColorScheme() === 'dark';
  const palette = isDark ? Colors.dark : Colors.light;
  const strokeColor = isDark ? '#f5f1ea' : '#1a1612';
  const hasHiddenNativeSplash = useRef(false);

  const stemEnd = useSharedValue(0);
  const bowlEnd = useSharedValue(0);
  const accentScale = useSharedValue(0);
  const wordmarkProgress = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);

  const { stemPath, bowlPath } = useMemo(() => {
    const stem = Skia.Path.Make();
    stem.moveTo(22, 12);
    stem.lineTo(22, 118);

    const bowl = Skia.Path.MakeFromSVGString(
      'M 22 62 Q 52 52, 66 75 Q 80 98, 66 112 Q 52 122, 22 115',
    );

    return { stemPath: stem, bowlPath: bowl ?? Skia.Path.Make() };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function run() {
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);

      if (isCancelled) {
        return;
      }

      const finish = () => {
        overlayOpacity.value = withTiming(
          0,
          { duration: REVEAL_DURATION_MS, easing: Easing.in(Easing.quad) },
          (finished) => {
            if (finished) {
              runOnJS(onFinish)();
            }
          },
        );
      };

      if (reduceMotion) {
        stemEnd.value = 1;
        bowlEnd.value = 1;
        accentScale.value = 1;
        wordmarkProgress.value = 1;
        setTimeout(finish, 600);
        return;
      }

      const drawEasing = Easing.out(Easing.cubic);
      stemEnd.value = withTiming(1, { duration: STEM_DURATION_MS, easing: drawEasing });
      bowlEnd.value = withDelay(
        BOWL_DELAY_MS,
        withTiming(1, { duration: BOWL_DURATION_MS, easing: drawEasing }),
      );
      accentScale.value = withDelay(
        ACCENT_DELAY_MS,
        withSpring(1, { damping: 12, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.Never }),
      );
      wordmarkProgress.value = withDelay(
        ACCENT_DELAY_MS,
        withTiming(1, { duration: 450, easing: drawEasing }),
      );

      setTimeout(finish, HOLD_UNTIL_MS);
    }

    void run();

    return () => {
      isCancelled = true;
    };
  }, [accentScale, bowlEnd, onFinish, overlayOpacity, stemEnd, wordmarkProgress]);

  const accentRadius = useDerivedValue(() => Math.max(accentScale.value, 0) * 9);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkProgress.value,
    transform: [{ translateY: (1 - wordmarkProgress.value) * 10 }],
  }));

  const canvasWidth = MARK_WIDTH * MARK_SCALE;
  const canvasHeight = MARK_HEIGHT * MARK_SCALE;

  return (
    <Animated.View
      style={[styles.overlay, { backgroundColor: palette.background }, overlayStyle]}
      pointerEvents="none"
      onLayout={() => {
        // Swap from the native splash only after this overlay has committed a
        // frame — the backgrounds match, so the handoff is invisible.
        if (!hasHiddenNativeSplash.current) {
          hasHiddenNativeSplash.current = true;
          void SplashScreen.hideAsync();
        }
      }}
    >
      <AuroraBackdrop />
      <Canvas style={{ width: canvasWidth, height: canvasHeight }}>
        <Group transform={[{ scale: MARK_SCALE }]}>
          <Path
            path={stemPath}
            style="stroke"
            strokeWidth={8}
            strokeCap="round"
            color={strokeColor}
            start={0}
            end={stemEnd}
          />
          <Path
            path={bowlPath}
            style="stroke"
            strokeWidth={8}
            strokeCap="round"
            color={strokeColor}
            start={0}
            end={bowlEnd}
          />
          <Circle cx={95} cy={115} r={accentRadius} color={palette.accent} />
        </Group>
      </Canvas>
      <Animated.View style={wordmarkStyle}>
        <Text style={[styles.wordmark, { color: palette.text }]}>beisammen</Text>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
});
