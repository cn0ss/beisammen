import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { MotionDuration } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

interface UsageMeterProps {
  label: string;
  /** Big value line, e.g. "1,2 GB" or "38". */
  value: string;
  /** Right-aligned quota line, e.g. "von 5 GB". */
  quota?: string;
  /** 0–1 fraction of the quota that is used; omit for unlimited features. */
  fraction?: number;
  /** Sub-line under the bar, e.g. remaining amount or reset date. */
  detail?: string;
  delayMs?: number;
}

/**
 * Full-width quota meter: large value, thick animated bar, detail line.
 * Turns to the danger color as the quota fills up (>= 90%).
 */
export const UsageMeter = memo(function UsageMeter({
  label,
  value,
  quota,
  fraction,
  detail,
  delayMs = 0,
}: UsageMeterProps) {
  const theme = useTheme();
  const clamped = fraction === undefined ? null : Math.max(0, Math.min(fraction, 1));
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withDelay(
      delayMs,
      withTiming(clamped ?? 0, {
        duration: MotionDuration.slow * 2,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [clamped, delayMs, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  const isNearLimit = clamped !== null && clamped >= 0.9;
  const fillColor = isNearLimit ? theme.danger : theme.primary;
  const percentLabel =
    fraction === undefined ? null : `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)} %`;

  return (
    <View style={styles.meter}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
        {percentLabel ? (
          <Text
            style={[
              styles.percent,
              { color: isNearLimit ? theme.danger : theme.textSecondary },
            ]}
          >
            {percentLabel}
          </Text>
        ) : null}
      </View>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: isNearLimit ? theme.danger : theme.text }]}>
          {value}
        </Text>
        {quota ? (
          <Text style={[styles.quota, { color: theme.textTertiary }]}>{quota}</Text>
        ) : null}
      </View>
      {clamped !== null ? (
        <View style={[styles.track, { backgroundColor: theme.borderLight }]}>
          <Animated.View
            style={[styles.fill, { backgroundColor: fillColor }, fillStyle]}
          />
        </View>
      ) : null}
      {detail ? (
        <Text style={[styles.detail, { color: theme.textTertiary }]}>{detail}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  meter: {
    gap: Spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  percent: {
    fontSize: FontSize.sm,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  value: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  quota: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  track: {
    height: 10,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  detail: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
});
