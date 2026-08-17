import Ionicons from '@expo/vector-icons/Ionicons';
import { T, useGT } from 'gt-react-native';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ActivityEventRecord } from '@/features/convex/api';
import { useUserProfileImageUrl } from '@/features/media/use-user-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

type ActivityStatus = 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';

interface ActivityStripProps {
  activities: ActivityEventRecord[];
  status: ActivityStatus;
  onOpenShare: (shareBatchId: string, assetId?: string | null) => void;
  onLoadMore: () => void;
}

function activityIcon(type: ActivityEventRecord['type']): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'share.published':
      return 'images-outline';
    case 'comment.created':
      return 'chatbubble-ellipses-outline';
    case 'reaction.set':
      return 'heart-outline';
    default:
      return 'notifications-outline';
  }
}

const ActivityRow = memo(function ActivityRow({
  activity,
  hasSeparator,
  onOpenShare,
}: {
  activity: ActivityEventRecord;
  hasSeparator: boolean;
  onOpenShare: (shareBatchId: string, assetId?: string | null) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const customProfileImageUrl = useUserProfileImageUrl(
    activity.actorId,
    activity.actorHasProfileImage,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt('{text} Beitrag öffnen', { text: activity.displayText })}
      onPress={() => onOpenShare(activity.shareBatchId, activity.assetId)}
      style={({ pressed }) => [
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Avatar
        name={activity.actorName}
        imageUrl={customProfileImageUrl ?? activity.actorAvatarUrl ?? null}
        size="sm"
      />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
          {activity.displayText}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
          <Text style={[styles.rowMetaCircle, { color: theme.primary }]}>
            {activity.circleName}
          </Text>
          {' · '}
          {activity.createdAtLabel}
        </Text>
      </View>
      <View style={[styles.iconBubble, { backgroundColor: theme.primaryMuted }]}>
        <Ionicons name={activityIcon(activity.type)} size={15} color={theme.primary} />
      </View>
    </Pressable>
  );
});

export const ActivityStrip = memo(function ActivityStrip({
  activities,
  onLoadMore,
  onOpenShare,
  status,
}: ActivityStripProps) {
  const theme = useTheme();
  const gt = useGT();
  const isLoadingFirstPage = status === 'LoadingFirstPage';
  const isLoadingMore = status === 'LoadingMore';
  const canLoadMore = status !== 'Exhausted';

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <T>
          <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Aktivität</Text>
        </T>
        <Text style={[styles.count, { color: theme.textTertiary }]}>
          {activities.length.toString().padStart(2, '0')}
        </Text>
      </View>

      <View style={[styles.list, { backgroundColor: theme.surface }]}>
        {isLoadingFirstPage ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        ) : activities.length > 0 ? (
          activities.map((activity, index) => (
            <ActivityRow
              key={activity._id}
              activity={activity}
              hasSeparator={index < activities.length - 1}
              onOpenShare={onOpenShare}
            />
          ))
        ) : (
          <View style={styles.emptyRow}>
            <Ionicons name="sparkles-outline" size={16} color={theme.textTertiary} />
            <T>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Noch keine neuen Aktivitäten.
              </Text>
            </T>
          </View>
        )}
      </View>

      {activities.length > 0 && canLoadMore ? (
        <Button
          label={isLoadingMore ? gt('Lädt...') : gt('Mehr Aktivität')}
          icon="chevron-down-outline"
          variant="outline"
          loading={isLoadingMore}
          disabled={isLoadingMore}
          onPress={onLoadMore}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  count: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  list: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    lineHeight: 18,
  },
  rowMeta: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  rowMetaCircle: {
    fontSize: FontSize.xs,
    fontWeight: '800',
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRow: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  emptyText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
