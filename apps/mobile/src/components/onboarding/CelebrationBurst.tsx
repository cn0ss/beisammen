import { Canvas, Circle } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const BURST_DURATION_MS = 850;
const PARTICLE_COUNT = 14;

interface Particle {
  angle: number;
  distance: number;
  radius: number;
  color: string;
  /** Angular drift over the flight, alternating direction — a soft swirl. */
  swirl: number;
  /** Depth feel: positive particles fly "toward" the viewer and grow. */
  depthGrowth: number;
}

function BurstParticle({
  particle,
  progress,
  center,
}: {
  particle: Particle;
  progress: SharedValue<number>;
  center: number;
}) {
  const cx = useDerivedValue(() => {
    const eased = 1 - (1 - progress.value) ** 3;
    const angle = particle.angle + particle.swirl * eased;
    return center + Math.cos(angle) * particle.distance * eased;
  }, [center, particle]);
  const cy = useDerivedValue(() => {
    const eased = 1 - (1 - progress.value) ** 3;
    const angle = particle.angle + particle.swirl * eased;
    // A touch of gravity so the burst feels physical, not geometric.
    return center + Math.sin(angle) * particle.distance * eased + progress.value ** 2 * 14;
  }, [center, particle]);
  const opacity = useDerivedValue(() => 1 - progress.value ** 1.6, []);
  const r = useDerivedValue(
    () => Math.max(particle.radius * (1 + particle.depthGrowth * progress.value), 0),
    [particle],
  );

  return <Circle cx={cx} cy={cy} r={r} color={particle.color} opacity={opacity} />;
}

function Shockwave({
  progress,
  center,
  size,
  color,
}: {
  progress: SharedValue<number>;
  center: number;
  size: number;
  color: string;
}) {
  const r = useDerivedValue(() => {
    const eased = 1 - (1 - progress.value) ** 2;
    return size * (0.1 + eased * 0.34);
  }, [size]);
  const strokeWidth = useDerivedValue(() => 3 * (1 - progress.value) + 0.5, []);
  const opacity = useDerivedValue(() => 0.55 * (1 - progress.value), []);

  return (
    <Circle
      cx={center}
      cy={center}
      r={r}
      style="stroke"
      strokeWidth={strokeWidth}
      color={color}
      opacity={opacity}
    />
  );
}

interface CelebrationBurstProps {
  size?: number;
  /** Vertical offset of the burst overlay within its parent. */
  topOffset?: number;
}

/**
 * One-shot Skia confetti burst for success moments (e.g. first circle
 * created). Mount it when the moment happens; it plays once and stays quiet.
 * Skipped entirely under reduced motion.
 */
export const CelebrationBurst = memo(function CelebrationBurst({
  size = 200,
  topOffset = -40,
}: CelebrationBurstProps) {
  const theme = useTheme();
  const progress = useSharedValue(0);
  const center = size / 2;

  const particles = useMemo<Particle[]>(() => {
    const colors = [theme.primary, theme.accent, theme.textTertiary];

    return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      // Deterministic pseudo-randomness keeps the burst stable per mount.
      const jitter = ((index * 7919) % 100) / 100;

      return {
        angle: (index / PARTICLE_COUNT) * Math.PI * 2 + jitter * 0.5,
        distance: size * (0.28 + jitter * 0.18),
        radius: 2.5 + jitter * 2.5,
        color: colors[index % colors.length] ?? theme.primary,
        swirl: (index % 2 === 0 ? 1 : -1) * (0.25 + jitter * 0.3),
        depthGrowth: index % 3 === 0 ? 0.5 + jitter * 0.4 : -0.45,
      };
    });
  }, [size, theme.accent, theme.primary, theme.textTertiary]);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: BURST_DURATION_MS,
      easing: Easing.out(Easing.quad),
      reduceMotion: ReduceMotion.System,
    });
  }, [progress]);

  return (
    <View
      style={[styles.overlay, { width: size, height: size, top: topOffset }]}
      pointerEvents="none"
    >
      <Canvas style={{ width: size, height: size }}>
        <Shockwave progress={progress} center={center} size={size} color={theme.primary} />
        {particles.map((particle, index) => (
          <BurstParticle key={index} particle={particle} progress={progress} center={center} />
        ))}
      </Canvas>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 10,
  },
});
