import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { MotionDuration } from '@/lib/motion';

import { ShimmerBlock } from './skia/ShimmerBlock';

/**
 * Content placeholder — Skia shimmer bars sketching a text block. The fade-in
 * is delayed so fast loads never flash a skeleton.
 */
export const LoadingBox = memo(function LoadingBox() {
  return (
    <Animated.View
      entering={FadeIn.duration(MotionDuration.base).delay(150)}
      style={styles.container}
    >
      <ShimmerBlock height={16} widthFraction={0.55} />
      <ShimmerBlock height={12} widthFraction={1} />
      <ShimmerBlock height={12} widthFraction={0.8} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
});
