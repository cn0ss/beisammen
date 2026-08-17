import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const BASE_WIDTH = 110;
const BASE_HEIGHT = 130;
const STEM_DURATION_MS = 480;
const BOWL_DELAY_MS = 220;
const BOWL_DURATION_MS = 560;
const ACCENT_DELAY_MS = 720;

interface BrandMarkAnimatedProps {
  size?: number;
  tone?: 'dark' | 'light';
}

/**
 * Skia twin of the static BrandMark that draws itself in on mount — the same
 * pen-stroke choreography as the splash, for hero placements.
 */
export const BrandMarkAnimated = memo(function BrandMarkAnimated({
  size = 52,
  tone = 'dark',
}: BrandMarkAnimatedProps) {
  const theme = useTheme();
  const strokeColor = tone === 'dark' ? '#1a1612' : '#f5f1ea';
  const scale = size / BASE_WIDTH;
  const height = Math.round((size * BASE_HEIGHT) / BASE_WIDTH);

  const stemEnd = useSharedValue(0);
  const bowlEnd = useSharedValue(0);
  const accentScale = useSharedValue(0);

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
    const drawEasing = Easing.out(Easing.cubic);

    stemEnd.value = withTiming(1, {
      duration: STEM_DURATION_MS,
      easing: drawEasing,
      reduceMotion: ReduceMotion.System,
    });
    bowlEnd.value = withDelay(
      BOWL_DELAY_MS,
      withTiming(1, {
        duration: BOWL_DURATION_MS,
        easing: drawEasing,
        reduceMotion: ReduceMotion.System,
      }),
    );
    accentScale.value = withDelay(
      ACCENT_DELAY_MS,
      withSpring(1, {
        damping: 12,
        stiffness: 260,
        mass: 0.7,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [accentScale, bowlEnd, stemEnd]);

  const accentRadius = useDerivedValue(() => Math.max(accentScale.value, 0) * 9);

  return (
    <View style={{ width: size, height }} accessibilityElementsHidden>
      <Canvas style={{ width: size, height }}>
        <Group transform={[{ scale }]}>
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
          <Circle cx={95} cy={115} r={accentRadius} color={theme.accent} />
        </Group>
      </Canvas>
    </View>
  );
});
