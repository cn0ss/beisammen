import Ionicons from '@expo/vector-icons/Ionicons';
import { Num, T, useMessages, Var } from 'gt-react-native';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';
import type { CircleListItem } from '@/features/convex/api';
import { useCircleImageUrl } from '@/features/media/use-circle-image-url';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable, Card, LoadingBox, Avatar } from '@/components/ui';

import { settingsCopy } from './copy';

interface CirclesListProps {
  circles: CircleListItem[] | undefined;
  onOpenCircle: (circle: CircleListItem) => void;
}

export const CirclesList = memo(function CirclesList({
  circles,
  onOpenCircle,
}: CirclesListProps) {
  const theme = useTheme();
  const m = useMessages();

  if (circles === undefined) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  if (circles.length === 0) {
    return (
      <Card>
        <View style={styles.emptyRow}>
          <Ionicons name="albums-outline" size={20} color={theme.textTertiary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            {m(settingsCopy.emptyCirclesLabel)}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      {circles.map((circle, index) => (
        <CircleRow
          key={circle._id}
          circle={circle}
          hasSeparator={index < circles.length - 1}
          onOpenCircle={onOpenCircle}
        />
      ))}
    </Card>
  );
});

const CircleRow = memo(function CircleRow({
  circle,
  hasSeparator,
  onOpenCircle,
}: {
  circle: CircleListItem;
  hasSeparator: boolean;
  onOpenCircle: (circle: CircleListItem) => void;
}) {
  const theme = useTheme();
  const imageUrl = useCircleImageUrl(circle._id, circle.hasImage);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={circle.name}
      onPress={() => onOpenCircle(circle)}
      pressedScale={0.98}
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <Avatar name={circle.name} imageUrl={imageUrl} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: theme.text }]}>{circle.name}</Text>
        <T>
          <Text style={[styles.meta, { color: theme.textTertiary }]}>
            <Num>{circle.memberCount}</Num> Mitglieder · <Var>{circle.role}</Var>
          </Text>
        </T>
      </View>
      <Ionicons name="chevron-forward-outline" size={16} color={theme.textTertiary} />
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  card: {
    paddingVertical: Spacing.xs,
    gap: 0,
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: FontSize.base,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
});
