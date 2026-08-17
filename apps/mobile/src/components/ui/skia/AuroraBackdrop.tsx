import { Canvas, Circle, Group, RadialGradient, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const BREATH_DURATION_MS = 9000;

// Let the glow spill past the host bounds so no canvas edge falls inside the
// visible layout — a clipped edge reads as a hard rectangle behind the hero.
const BLEED = Spacing['2xl'];

/**
 * Soft, slowly breathing gradient blobs rendered with Skia behind hero
 * content. Purely decorative — absolutely filled, non-interactive, and
 * disabled for reduced motion via ReduceMotion.System. Each blob fades to
 * transparent at its own radius, so nothing is cut off at the canvas bounds
 * in either color scheme.
 */
export const AuroraBackdrop = memo(function AuroraBackdrop() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, {
        duration: BREATH_DURATION_MS,
        easing: Easing.inOut(Easing.sin),
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      true,
    );
  }, [phase]);

  // Radii scale with the smaller dimension and centers stay at least one
  // radius away from every bound, so a blob can never touch a canvas edge.
  const minDim = Math.min(layout.width, layout.height);
  const primaryCenter = useDerivedValue(
    () =>
      vec(
        layout.width * (0.32 + phase.value * 0.06),
        layout.height * (0.42 - phase.value * 0.04),
      ),
    [layout.width, layout.height],
  );
  const primaryR = useDerivedValue(
    () => minDim * (0.3 + phase.value * 0.04),
    [minDim],
  );
  const accentCenter = useDerivedValue(
    () =>
      vec(
        layout.width * (0.68 - phase.value * 0.05),
        layout.height * (0.58 + phase.value * 0.04),
      ),
    [layout.width, layout.height],
  );
  const accentR = useDerivedValue(
    () => minDim * (0.26 + phase.value * 0.05),
    [minDim],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const groupOpacity = isDark ? 0.22 : 0.32;

  return (
    <View
      style={styles.bleed}
      pointerEvents="none"
      accessibilityElementsHidden
      onLayout={handleLayout}
    >
      {layout.width > 0 && layout.height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group opacity={groupOpacity}>
            {/* Fade to the same hue at zero alpha — fading to transparent
                black muddies the falloff into gray on light backgrounds. */}
            <Circle c={primaryCenter} r={primaryR}>
              <RadialGradient
                c={primaryCenter}
                r={primaryR}
                colors={[theme.primary, `${theme.primary}00`]}
              />
            </Circle>
            <Circle c={accentCenter} r={accentR}>
              <RadialGradient
                c={accentCenter}
                r={accentR}
                colors={[theme.accent, `${theme.accent}00`]}
              />
            </Circle>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  bleed: {
    position: 'absolute',
    top: -BLEED,
    left: -BLEED,
    right: -BLEED,
    bottom: -BLEED,
  },
});
