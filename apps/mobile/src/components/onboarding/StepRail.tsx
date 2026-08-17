import { Canvas, Circle, Line, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FontSize, Spacing } from '@/constants/theme';
import { MotionDuration } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

const RAIL_HEIGHT = 24;
const NODE_RADIUS = 5;
const PULSE_DURATION_MS = 1600;

interface StepRailProps {
  steps: string[];
  /** 0-based index of the current step; the fill animates to it. */
  activeIndex: number;
}

/**
 * Horizontal step indicator — a Skia track whose fill sweeps to the active
 * node whenever the step advances.
 */
export const StepRail = memo(function StepRail({ steps, activeIndex }: StepRailProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  const pulse = useSharedValue(0);

  const clampedIndex = Math.max(0, Math.min(activeIndex, steps.length - 1));
  const targetFraction = steps.length > 1 ? clampedIndex / (steps.length - 1) : 1;

  useEffect(() => {
    progress.value = withTiming(targetFraction, {
      duration: MotionDuration.slow,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [progress, targetFraction]);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, {
        duration: PULSE_DURATION_MS,
        easing: Easing.inOut(Easing.sin),
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      true,
    );
  }, [pulse]);

  const inset = NODE_RADIUS + 2;
  const trackWidth = Math.max(width - inset * 2, 0);
  const fillEnd = useDerivedValue(
    () => vec(inset + trackWidth * progress.value, RAIL_HEIGHT / 2),
    [inset, trackWidth],
  );
  const haloRadius = useDerivedValue(() => NODE_RADIUS + 3 + pulse.value * 3, []);
  const haloOpacity = useDerivedValue(() => 0.28 - pulse.value * 0.14, []);

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  };

  return (
    <View accessibilityElementsHidden>
      <View style={{ height: RAIL_HEIGHT }} onLayout={handleLayout}>
        {width > 0 ? (
          <Canvas style={{ width, height: RAIL_HEIGHT }}>
            <Line
              p1={vec(inset, RAIL_HEIGHT / 2)}
              p2={vec(width - inset, RAIL_HEIGHT / 2)}
              strokeWidth={2}
              color={theme.borderLight}
            />
            <Line
              p1={vec(inset, RAIL_HEIGHT / 2)}
              p2={fillEnd}
              strokeWidth={2}
              color={theme.primary}
            />
            <Circle c={fillEnd} r={haloRadius} color={theme.primary} opacity={haloOpacity} />
            {steps.map((step, index) => {
              const fraction = steps.length > 1 ? index / (steps.length - 1) : 0;
              const cx = inset + trackWidth * fraction;
              const isReached = index <= clampedIndex;

              return (
                <Circle
                  key={step}
                  cx={cx}
                  cy={RAIL_HEIGHT / 2}
                  r={NODE_RADIUS}
                  color={isReached ? theme.primary : theme.borderLight}
                />
              );
            })}
          </Canvas>
        ) : null}
      </View>
      <View style={styles.labels}>
        {steps.map((step, index) => (
          <Text
            key={step}
            style={[
              styles.label,
              {
                color: index <= clampedIndex ? theme.primary : theme.textTertiary,
                textAlign: index === 0 ? 'left' : index === steps.length - 1 ? 'right' : 'center',
              },
            ]}
          >
            {step}
          </Text>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  label: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
