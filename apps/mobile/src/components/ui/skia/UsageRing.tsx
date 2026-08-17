import { Canvas, Path, Skia, SweepGradient, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { FontSize } from '@/constants/theme';
import { MotionDuration } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

interface UsageRingProps {
  /** 0–1 fraction of the quota that is used. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Short center label, e.g. "42%" or "12". */
  centerLabel: string;
  delayMs?: number;
}

/**
 * Skia quota meter — a rounded arc that sweeps in on mount. Turns to the
 * danger color as the quota fills up (>= 90%).
 */
export const UsageRing = memo(function UsageRing({
  progress,
  size = 52,
  strokeWidth = 5,
  centerLabel,
  delayMs = 0,
}: UsageRingProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(progress, 1));
  const end = useSharedValue(0);

  useEffect(() => {
    end.value = withDelay(
      delayMs,
      withTiming(clamped, {
        duration: MotionDuration.slow * 2,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [clamped, delayMs, end]);

  const ringPath = useMemo(() => {
    const path = Skia.Path.Make();
    const inset = strokeWidth / 2 + 1;
    path.addArc(
      { x: inset, y: inset, width: size - inset * 2, height: size - inset * 2 },
      -90,
      360,
    );
    return path;
  }, [size, strokeWidth]);

  const isNearLimit = clamped >= 0.9;
  const sweepColors = isNearLimit
    ? [theme.danger, theme.danger]
    : [theme.primary, theme.accent];

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      <Canvas style={{ width: size, height: size }}>
        <Path
          path={ringPath}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
          color={theme.borderLight}
        />
        <Path
          path={ringPath}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
          start={0}
          end={end}
        >
          <SweepGradient
            c={vec(size / 2, size / 2)}
            colors={[...sweepColors, sweepColors[0] ?? theme.primary]}
          />
        </Path>
      </Canvas>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.center}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.centerLabel, { color: isNearLimit ? theme.danger : theme.text }]}
          >
            {centerLabel}
          </Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    fontSize: FontSize.xs,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
