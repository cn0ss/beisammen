import Ionicons from '@expo/vector-icons/Ionicons';
import { Num, T, useGT } from 'gt-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useMutation, usePaginatedQuery } from 'convex/react';
import { COMMENT_MAX_BODY_LENGTH } from '@beisammen/contracts';

import { AnimatedPressable, Avatar, Button, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type {
  CommentRecord,
  ShareAssetRecord,
  ShareBatchRecord,
} from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { buildCommentTarget, normalizeCommentDraft } from '@/features/engagement/validation';
import { useUserProfileImageUrl } from '@/features/media/use-user-profile-image-url';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

const COMMENT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'short',
  timeStyle: 'short',
};

const CommentRow = memo(function CommentRow({
  comment,
  onDelete,
}: {
  comment: CommentRecord;
  onDelete: (comment: CommentRecord) => void;
}) {
  const theme = useTheme();
  const gt = useGT();
  const commentTimeFormat = useDateFormat(COMMENT_TIME_OPTIONS);
  const customImageUrl = useUserProfileImageUrl(comment.authorId, comment.authorHasProfileImage);
  const avatarUrl = customImageUrl ?? comment.authorAvatarUrl ?? null;

  return (
    <View style={styles.commentRow}>
      <Avatar name={comment.authorName} imageUrl={avatarUrl} size="sm" />
      <View style={styles.commentContent}>
        <View style={styles.commentHeader}>
          <Text style={[styles.commentAuthor, { color: theme.text }]} numberOfLines={1}>
            {comment.authorName}
          </Text>
          <Text style={[styles.commentTime, { color: theme.textTertiary }]}>
            {commentTimeFormat.format(new Date(comment.createdAt))}
          </Text>
          {comment.canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt('Kommentar entfernen')}
              hitSlop={10}
              onPress={() => onDelete(comment)}
            >
              <Ionicons name="trash-outline" size={14} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.commentBody, { color: theme.textSecondary }]}>{comment.body}</Text>
      </View>
    </View>
  );
});

function ScopeChip({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const theme = useTheme();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.96}
      style={[
        styles.scopeChip,
        { backgroundColor: selected ? theme.primaryMuted : theme.surfacePressed },
      ]}
    >
      <Ionicons name={icon} size={14} color={selected ? theme.primary : theme.textSecondary} />
      <Text
        style={[
          styles.scopeChipText,
          { color: selected ? theme.primary : theme.textSecondary },
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

/**
 * The conversation under a share: comments on the whole post or — for posts
 * with several photos — on the one currently in view, chosen with two chips.
 */
export const EngagementPanel = memo(function EngagementPanel({
  activeAsset,
  onFeedback,
  share,
}: {
  activeAsset: ShareAssetRecord | null;
  onFeedback: (message: string | null) => void;
  share: ShareBatchRecord;
}) {
  const theme = useTheme();
  const gt = useGT();
  const [engagementScope, setEngagementScope] = useState<'share' | 'asset'>('share');
  const [commentDraft, setCommentDraft] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const hasMultipleAssets = share.assets.length > 1;

  const commentTarget = useMemo(
    () =>
      buildCommentTarget({
        shareBatchId: share._id,
        activeAssetId: engagementScope === 'asset' ? activeAsset?._id : null,
      }),
    [activeAsset?._id, engagementScope, share._id],
  );
  const commentsPage = usePaginatedQuery(
    api.comments.listForShare,
    {
      shareBatchId: share._id,
      ...(commentTarget.assetId ? { assetId: commentTarget.assetId } : {}),
    },
    { initialNumItems: 20 },
  );
  const createComment = useMutation(api.comments.create);
  const deleteComment = useMutation(api.comments.delete);

  useEffect(() => {
    if (engagementScope === 'asset' && (!activeAsset || !hasMultipleAssets)) {
      setEngagementScope('share');
    }
  }, [activeAsset, engagementScope, hasMultipleAssets]);

  const handleSubmitComment = useCallback(async () => {
    setIsSubmittingComment(true);
    onFeedback(null);

    try {
      const body = normalizeCommentDraft(commentDraft);
      await createComment({
        shareBatchId: commentTarget.shareBatchId,
        ...(commentTarget.assetId ? { assetId: commentTarget.assetId } : {}),
        body,
      });
      setCommentDraft('');
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Kommentar konnte nicht gespeichert werden.'),
      );
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentDraft, commentTarget, createComment, gt, onFeedback]);

  const handleDeleteComment = useCallback(
    (comment: CommentRecord) => {
      Alert.alert(
        gt('Kommentar entfernen?'),
        gt('Dieser Kommentar wird für alle Mitglieder entfernt.'),
        [
          { text: gt('Abbrechen'), style: 'cancel' },
          {
            text: gt('Entfernen'),
            style: 'destructive',
            onPress: () => {
              onFeedback(null);
              void deleteComment({ commentId: comment._id }).catch((error) => {
                onFeedback(
                  error instanceof Error
                    ? error.message
                    : gt('Kommentar konnte nicht entfernt werden.'),
                );
              });
            },
          },
        ],
      );
    },
    [deleteComment, gt, onFeedback],
  );

  const targetSummary =
    commentTarget.targetKind === 'asset' ? activeAsset?.engagement : share.shareTargetEngagement;
  const comments = commentsPage.results;
  const isCommentsLoading = commentsPage.status === 'LoadingFirstPage';
  const hasMoreComments = commentsPage.status !== 'Exhausted';
  const canSubmitComment =
    !isCommentsLoading && !isSubmittingComment && commentDraft.trim().length > 0;
  const assetScopeIndex = activeAsset
    ? share.assets.findIndex((asset) => asset._id === activeAsset._id)
    : -1;

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <T>
          <Text style={[styles.title, { color: theme.text }]}>Gespräch</Text>
          <Text style={[styles.meta, { color: theme.textTertiary }]}>
            <Num>{targetSummary?.commentCount ?? 0}</Num> Kommentare
          </Text>
        </T>
      </View>

      {hasMultipleAssets ? (
        <View style={styles.scopeRow}>
          <ScopeChip
            icon="albums-outline"
            label={gt('Ganzer Beitrag')}
            selected={engagementScope === 'share'}
            onPress={() => setEngagementScope('share')}
          />
          <ScopeChip
            icon={activeAsset?.kind === 'video' ? 'videocam-outline' : 'image-outline'}
            label={
              activeAsset?.kind === 'video'
                ? gt('Video {position}', { position: assetScopeIndex + 1 })
                : gt('Foto {position}', { position: assetScopeIndex + 1 })
            }
            selected={engagementScope === 'asset'}
            onPress={() => setEngagementScope('asset')}
          />
        </View>
      ) : null}

      <View style={styles.composerRow}>
        <TextInput
          accessibilityLabel={gt('Kommentar schreiben')}
          value={commentDraft}
          onChangeText={setCommentDraft}
          placeholder={
            engagementScope === 'asset'
              ? gt('Zu diesem Medium schreiben…')
              : gt('Antwort schreiben…')
          }
          placeholderTextColor={theme.textTertiary}
          multiline
          maxLength={COMMENT_MAX_BODY_LENGTH}
          style={[
            styles.composerInput,
            {
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.background,
            },
          ]}
        />
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Kommentar senden')}
          disabled={!canSubmitComment}
          onPress={() => {
            void handleSubmitComment();
          }}
          pressedScale={0.92}
          style={[styles.sendButton, { backgroundColor: theme.primary }]}
        >
          {isSubmittingComment ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Ionicons name="arrow-up" size={19} color={theme.primaryText} />
          )}
        </AnimatedPressable>
      </View>
      {commentDraft.length > 0 ? (
        <Text style={[styles.composerLimit, { color: theme.textTertiary }]}>
          {commentDraft.length}/{COMMENT_MAX_BODY_LENGTH}
        </Text>
      ) : null}

      <View style={styles.commentsList}>
        {isCommentsLoading ? (
          <LoadingBox />
        ) : comments.length > 0 ? (
          comments.map((comment, index) => (
            <View key={comment._id}>
              {index > 0 ? (
                <View style={[styles.separator, { backgroundColor: theme.borderLight }]} />
              ) : null}
              <CommentRow comment={comment} onDelete={handleDeleteComment} />
            </View>
          ))
        ) : (
          <T>
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
              Noch keine Kommentare — schreib den ersten.
            </Text>
          </T>
        )}

        {hasMoreComments && comments.length > 0 ? (
          <Button
            label={commentsPage.status === 'LoadingMore' ? gt('Lädt...') : gt('Mehr laden')}
            icon="chevron-down-outline"
            variant="ghost"
            loading={commentsPage.status === 'LoadingMore'}
            onPress={() => commentsPage.loadMore(20)}
          />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    borderRadius: Radius.xl,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  header: {
    gap: 2,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  meta: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  scopeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
  },
  scopeChipText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: FontSize.base,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerLimit: {
    alignSelf: 'flex-end',
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    marginTop: -Spacing.xs,
  },
  commentsList: {
    gap: Spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
    marginLeft: 32 + Spacing.sm,
  },
  commentRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  commentContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  commentAuthor: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  commentTime: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '600',
  },
  commentBody: {
    fontSize: FontSize.base,
    lineHeight: 21,
  },
  emptyText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
