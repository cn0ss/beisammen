import Ionicons from '@expo/vector-icons/Ionicons';
import { Num, T } from 'gt-react-native';
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

import type { CircleUsageBreakdown, CircleUsageBreakdownItem } from '@beisammen/contracts';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { formatBytes } from '@/features/media/client';
import { useCircleImageUrl } from '@/features/media/use-circle-image-url';
import { MotionDuration } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

import { Avatar, Card, LoadingBox } from '@/components/ui';

interface CircleUsageListProps {
  breakdown: CircleUsageBreakdown | undefined;
}

/** Per-circle usage: avatar, media counts, and a share bar relative to the largest circle. */
export const CircleUsageList = memo(function CircleUsageList({ breakdown }: CircleUsageListProps) {
  const theme = useTheme();

  if (breakdown === undefined) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  if (breakdown.circles.length === 0) {
    return (
      <Card>
        <View style={styles.emptyRow}>
          <Ionicons name="albums-outline" size={20} color={theme.textTertiary} />
          <T>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              Noch keine Circles mit Medien.
            </Text>
          </T>
        </View>
      </Card>
    );
  }

  const maxSizeBytes = Math.max(
    1,
    ...breakdown.circles.map((circle) => circle.totalSizeBytes),
  );

  return (
    <Card>
      {breakdown.circles.map((circle, index) => (
        <CircleUsageRow
          key={circle.circleId}
          circle={circle}
          shareOfLargest={circle.totalSizeBytes / maxSizeBytes}
          hasSeparator={index < breakdown.circles.length - 1}
          delayMs={Math.min(index, 8) * 60}
        />
      ))}
      {breakdown.isTruncated ? (
        <T>
          <Text style={[styles.truncatedHint, { color: theme.textTertiary }]}>
            Es werden die zuletzt beigetretenen Circles angezeigt.
          </Text>
        </T>
      ) : null}
    </Card>
  );
});

const CircleUsageRow = memo(function CircleUsageRow({
  circle,
  shareOfLargest,
  hasSeparator,
  delayMs,
}: {
  circle: CircleUsageBreakdownItem;
  shareOfLargest: number;
  hasSeparator: boolean;
  delayMs: number;
}) {
  const theme = useTheme();
  const imageUrl = useCircleImageUrl(circle.circleId, circle.hasImage);
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withDelay(
      delayMs,
      withTiming(Math.max(0.02, Math.min(shareOfLargest, 1)), {
        duration: MotionDuration.slow * 2,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [delayMs, fill, shareOfLargest]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Avatar name={circle.name} imageUrl={imageUrl} size="sm" />
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {circle.name}
        </Text>
        <Text style={[styles.size, { color: theme.text }]}>
          {formatBytes(circle.totalSizeBytes) ?? '0 KB'}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.borderLight }]}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: circle.isOwner ? theme.primary : theme.accent },
            fillStyle,
          ]}
        />
      </View>
      <T>
        <Text style={[styles.meta, { color: theme.textTertiary }]}>
          <Num>{circle.imageCount}</Num> Fotos · <Num>{circle.videoCount}</Num> Videos ·{' '}
          <Num>{circle.memberCount}</Num> Mitglieder
        </Text>
      </T>
    </View>
  );
});

const styles = StyleSheet.create({
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  row: {
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: FontSize.base,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  size: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 6,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  meta: {
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  truncatedHint: {
    fontSize: FontSize.xs,
    lineHeight: 16,
    textAlign: 'center',
  },
});
