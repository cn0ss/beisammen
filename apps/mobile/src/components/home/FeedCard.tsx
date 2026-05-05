import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ShareFeedItem } from '@/features/convex/api';
import { useSignedAssetUrl } from '@/features/media/use-signed-asset-url';
import { useTheme } from '@/hooks/use-theme';
import { Avatar } from '@/components/ui';

const IMAGE_HEIGHT = 340;

const MONTH_SHORT = new Intl.DateTimeFormat('de-DE', { month: 'short' });

function formatDayMonth(timestamp: number): { day: string; month: string } {
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_SHORT.format(date).replace('.', '').toUpperCase();
  return { day, month };
}

function splitLead(caption: string): { lead: string; tail: string | null } {
  const trimmed = caption.trim();
  const match = trimmed.match(/^([^.!?]{3,80}[.!?])\s+(.+)$/s);
  if (!match) {
    return { lead: trimmed, tail: null };
  }
  return { lead: match[1], tail: match[2] };
}

const CaptionText = memo(function CaptionText({
  caption,
  accentColor,
  baseColor,
}: {
  caption: string;
  accentColor: string;
  baseColor: string;
}) {
  const { lead, tail } = useMemo(() => splitLead(caption), [caption]);

  return (
    <View style={styles.captionBlock}>
      <Text
        allowFontScaling={false}
        style={[styles.captionLeadIn, { color: accentColor }]}
      >
        —
      </Text>
      <Text style={[styles.caption, { color: baseColor }]} numberOfLines={4}>
        {lead}
        {tail ? (
          <>
            {'  '}
            <Text style={[styles.captionAccent, { color: accentColor }]}>{tail}</Text>
          </>
        ) : null}
      </Text>
    </View>
  );
});

function formatCompactCount(count: number): string {
  if (count >= 1000) {
    return `${Math.floor(count / 100) / 10}k`;
  }

  return String(count);
}

const EngagementSummaryRow = memo(function EngagementSummaryRow({
  share,
}: {
  share: ShareFeedItem;
}) {
  const theme = useTheme();
  const hasComments = share.engagement.commentCount > 0;
  const hasReactions = share.engagement.reactionCount > 0;

  if (!hasComments && !hasReactions) {
    return null;
  }

  return (
    <View style={styles.engagementRow}>
      {hasReactions ? (
        <View style={[styles.reactionStack, { backgroundColor: theme.accentMuted }]}>
          {share.engagement.topReactions.map((reaction) => (
            <Text key={reaction.emoji} style={styles.reactionEmoji}>
              {reaction.emoji}
            </Text>
          ))}
          <Text style={[styles.engagementText, { color: theme.accent }]}>
            {formatCompactCount(share.engagement.reactionCount)}
          </Text>
        </View>
      ) : null}

      {hasComments ? (
        <View style={[styles.commentPill, { backgroundColor: theme.primaryMuted }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color={theme.primary} />
          <Text style={[styles.engagementText, { color: theme.primary }]}>
            {formatCompactCount(share.engagement.commentCount)}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

interface FeedCardProps {
  share: ShareFeedItem;
  currentUserId?: string | null;
  currentProfileImageUrl?: string | null;
  isDeleting?: boolean;
  onOpenShare: (shareId: string) => void;
  onDeleteShare: (shareId: string) => void;
}

export const FeedCard = memo(function FeedCard({
  share,
  currentUserId,
  currentProfileImageUrl,
  isDeleting = false,
  onOpenShare,
  onDeleteShare,
}: FeedCardProps) {
  const theme = useTheme();
  const heroAsset = share.heroAsset;
  const heroUrl = useSignedAssetUrl(
    heroAsset && (heroAsset.kind === 'image' || heroAsset.previewStorage) ? heroAsset._id : null,
    'preview',
  );
  const hasMultipleAssets = share.assetCount > 1;
  const { day, month } = useMemo(
    () => formatDayMonth(share.publishedAt ?? share._creationTime),
    [share.publishedAt, share._creationTime],
  );

  const handlePress = useCallback(() => onOpenShare(share._id), [onOpenShare, share._id]);
  const handleDelete = useCallback(() => onDeleteShare(share._id), [onDeleteShare, share._id]);

  const authorImageUrl =
    currentUserId && share.authorId === currentUserId
      ? currentProfileImageUrl ?? share.authorAvatarUrl ?? null
      : share.authorAvatarUrl ?? null;

  return (
    <View style={styles.card}>
      {/* Hero photo with overlays */}
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.imageWrapper,
          {
            backgroundColor: theme.surfacePressed,
            opacity: pressed ? 0.97 : 1,
            transform: [{ scale: pressed ? 0.992 : 1 }],
            ...Platform.select({
              ios: { shadowColor: theme.text },
              android: {},
            }),
          },
        ]}
      >
        {heroAsset && heroUrl ? (
          <Image
            source={{ uri: heroUrl }}
            style={styles.heroImage}
            contentFit="cover"
            transition={280}
            recyclingKey={heroAsset._id}
          />
        ) : heroAsset ? (
          <View style={styles.imagePlaceholder}>
            <Ionicons
              name={heroAsset.kind === 'video' ? 'play-circle' : 'image-outline'}
              size={40}
              color={theme.textTertiary}
            />
          </View>
        ) : null}

        {/* Date "postcard stamp" — top right */}
        <View style={[styles.dateStamp, { backgroundColor: theme.surface }]}>
          <Text
            allowFontScaling={false}
            style={[styles.dateDay, { color: theme.text }]}
          >
            {day}
          </Text>
          <View style={[styles.dateRule, { backgroundColor: theme.accent }]} />
          <Text
            allowFontScaling={false}
            style={[styles.dateMonth, { color: theme.textSecondary }]}
          >
            {month}
          </Text>
        </View>

        {/* Video / multi-asset meta — top left */}
        {heroAsset?.kind === 'video' ? (
          <View style={styles.topLeftChip}>
            <Ionicons name="play" size={12} color="#FFFFFF" />
            <Text allowFontScaling={false} style={styles.topLeftChipText}>
              Video
            </Text>
          </View>
        ) : hasMultipleAssets ? (
          <View style={styles.topLeftChip}>
            <Ionicons name="albums-outline" size={12} color="#FFFFFF" />
            <Text allowFontScaling={false} style={styles.topLeftChipText}>
              {share.assetCount}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {/* Author row */}
      <View style={styles.authorRow}>
        <Avatar name={share.authorName ?? '?'} imageUrl={authorImageUrl} size="sm" />
        <View style={styles.authorInfo}>
          <Text
            style={[styles.authorName, { color: theme.text }]}
            numberOfLines={1}
          >
            {share.authorName}
          </Text>
          <Text
            style={[styles.timestamp, { color: theme.textTertiary }]}
            numberOfLines={1}
          >
            {share.createdAtLabel}
          </Text>
        </View>

        {share.canDelete ? (
          <Pressable
            hitSlop={12}
            disabled={isDeleting}
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Beitrag löschen"
            style={({ pressed }) => [
              styles.moreButton,
              {
                backgroundColor: theme.surfacePressed,
                opacity: pressed || isDeleting ? 0.5 : 1,
              },
            ]}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Caption */}
      {share.caption ? (
        <CaptionText caption={share.caption} accentColor={theme.accent} baseColor={theme.text} />
      ) : null}

      <EngagementSummaryRow share={share} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
  },
  imageWrapper: {
    width: '100%',
    height: IMAGE_HEIGHT,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 22,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateStamp: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    minWidth: 46,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.16,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  dateDay: {
    fontFamily: Fonts.display,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  dateRule: {
    width: 20,
    height: 1,
    marginVertical: 3,
    opacity: 0.8,
  },
  dateMonth: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  topLeftChip: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(12,12,14,0.55)',
  },
  topLeftChipText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  authorInfo: {
    flex: 1,
    gap: 1,
  },
  authorName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  timestamp: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  moreButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionBlock: {
    paddingHorizontal: Spacing.xs,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  captionLeadIn: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: -1,
  },
  caption: {
    flex: 1,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  captionAccent: {
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.md,
  },
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  reactionStack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reactionEmoji: {
    fontSize: FontSize.sm,
    lineHeight: 16,
  },
  commentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  engagementText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
});
