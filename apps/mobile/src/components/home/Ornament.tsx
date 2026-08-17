import { Canvas, Line, LinearGradient, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Fonts, Spacing } from '@/constants/theme';
import { MotionDuration } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

const RULE_HEIGHT = 12;

/**
 * Decorative editorial separator — Skia-drawn rules that "ink in" from the
 * center diamond outwards on mount, evoking a printed photo album page.
 */
export const Ornament = memo(function Ornament() {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const reveal = useSharedValue(0);

  useEffect(() => {
    reveal.value = withTiming(1, {
      duration: MotionDuration.slow * 1.5,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [reveal]);

  const GLYPH_GAP = 12;
  const center = width / 2;
  const leftEdge = center - GLYPH_GAP;
  const rightEdge = center + GLYPH_GAP;

  const leftStart = useDerivedValue(
    () => vec(leftEdge - leftEdge * reveal.value, RULE_HEIGHT / 2),
    [leftEdge],
  );
  const leftEnd = useDerivedValue(() => vec(leftEdge, RULE_HEIGHT / 2), [leftEdge]);
  const rightStart = useDerivedValue(() => vec(rightEdge, RULE_HEIGHT / 2), [rightEdge]);
  const rightEnd = useDerivedValue(
    () => vec(rightEdge + (width - rightEdge) * reveal.value, RULE_HEIGHT / 2),
    [rightEdge, width],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  };

  return (
    <View style={styles.row} pointerEvents="none" accessibilityElementsHidden>
      <View style={styles.canvasWrap} onLayout={handleLayout}>
        {width > 0 ? (
          <Canvas style={{ width, height: RULE_HEIGHT }}>
            <Line p1={leftStart} p2={leftEnd} strokeWidth={StyleSheet.hairlineWidth * 2}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(leftEdge, 0)}
                colors={['transparent', theme.border]}
                positions={[0, 0.35]}
              />
            </Line>
            <Line p1={rightStart} p2={rightEnd} strokeWidth={StyleSheet.hairlineWidth * 2}>
              <LinearGradient
                start={vec(rightEdge, 0)}
                end={vec(width, 0)}
                colors={[theme.border, 'transparent']}
                positions={[0.65, 1]}
              />
            </Line>
          </Canvas>
        ) : null}
      </View>
      <View style={styles.glyphWrap}>
        <Text
          allowFontScaling={false}
          style={[styles.glyph, { color: theme.accent }]}
        >
          ◆
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  canvasWrap: {
    alignSelf: 'stretch',
    height: RULE_HEIGHT,
  },
  glyphWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontFamily: Fonts.display,
    fontSize: 9,
    opacity: 0.9,
  },
});
