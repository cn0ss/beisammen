import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const SWEEP_DURATION_MS = 1400;

interface ShimmerBlockProps {
  height: number;
  /** 0–1 fraction of the measured parent width. */
  widthFraction?: number;
  radius?: number;
}

/**
 * Skia shimmer placeholder — a rounded bar with a highlight sweeping across
 * on the UI thread. Compose several to sketch the shape of loading content.
 */
export const ShimmerBlock = memo(function ShimmerBlock({
  height,
  widthFraction = 1,
  radius = Radius.sm,
}: ShimmerBlockProps) {
  const isDark = useColorScheme() === 'dark';
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    sweep.value = withRepeat(
      withTiming(1, {
        duration: SWEEP_DURATION_MS,
        easing: Easing.inOut(Easing.quad),
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      false,
    );
  }, [sweep]);

  const gradientStart = useDerivedValue(
    () => vec(width * (sweep.value * 2 - 1), 0),
    [width],
  );
  const gradientEnd = useDerivedValue(
    () => vec(width * (sweep.value * 2 - 0.4), height),
    [width, height],
  );

  const base = isDark ? '#2A2A2D' : '#EAE6DF';
  const highlight = isDark ? '#3A3A3E' : '#F7F4EE';

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  };

  return (
    <View
      style={{ width: `${widthFraction * 100}%`, height }}
      onLayout={handleLayout}
      accessibilityElementsHidden
    >
      {width > 0 ? (
        <Canvas style={{ width, height }}>
          <RoundedRect x={0} y={0} width={width} height={height} r={radius} color={base} />
          <RoundedRect x={0} y={0} width={width} height={height} r={radius}>
            <LinearGradient
              start={gradientStart}
              end={gradientEnd}
              colors={['transparent', highlight, 'transparent']}
            />
          </RoundedRect>
        </Canvas>
      ) : null}
    </View>
  );
});
