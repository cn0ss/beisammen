import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { COMMENT_MAX_BODY_LENGTH } from '@beisammen/contracts';

import { Button, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type {
  CommentRecord,
  ReactionTargetRecord,
  ShareAssetRecord,
  ShareBatchRecord,
} from '@/features/convex/api';
import { api } from '@/features/convex/api';
import {
  buildCommentTarget,
  normalizeCommentDraft,
  normalizeReactionEmoji,
} from '@/features/engagement/validation';
import { useTheme } from '@/hooks/use-theme';

const COMMENT_TIME = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatCommentTime(timestamp: number): string {
  return COMMENT_TIME.format(new Date(timestamp));
}

function reactionTargetMatches(
  target: ReactionTargetRecord,
  input: { targetKind: 'share' | 'asset'; assetId?: string },
) {
  return input.targetKind === 'share'
    ? target.targetKind === 'share' && target.assetId === null
    : target.targetKind === 'asset' && target.assetId === input.assetId;
}

const CommentRow = memo(function CommentRow({
  comment,
  onDelete,
}: {
  comment: CommentRecord;
  onDelete: (comment: CommentRecord) => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.commentRow, { borderColor: theme.borderLight }]}>
      <View style={styles.commentHeader}>
        <Text style={[styles.commentAuthor, { color: theme.text }]} numberOfLines={1}>
          {comment.authorName}
        </Text>
        <Text style={[styles.commentTime, { color: theme.textTertiary }]}>
          {formatCommentTime(comment.createdAt)}
        </Text>
      </View>
      <Text style={[styles.commentBody, { color: theme.textSecondary }]}>{comment.body}</Text>
      {comment.canDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kommentar entfernen"
          hitSlop={10}
          onPress={() => onDelete(comment)}
          style={styles.commentDelete}
        >
          <Ionicons name="trash-outline" size={14} color={theme.danger} />
          <Text style={[styles.commentDeleteText, { color: theme.danger }]}>Entfernen</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

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
  const [engagementScope, setEngagementScope] = useState<'share' | 'asset'>('share');
  const [commentDraft, setCommentDraft] = useState('');
  const [reactionDraft, setReactionDraft] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isReacting, setIsReacting] = useState(false);

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
  const reactionState = useQuery(api.reactions.listForShare, { shareBatchId: share._id });
  const createComment = useMutation(api.comments.create);
  const deleteComment = useMutation(api.comments.delete);
  const setReaction = useMutation(api.reactions.set);
  const removeReaction = useMutation(api.reactions.remove);

  useEffect(() => {
    if (engagementScope === 'asset' && !activeAsset) {
      setEngagementScope('share');
    }
  }, [activeAsset, engagementScope]);

  const activeReactionTarget = useMemo(() => {
    if (!reactionState) {
      return null;
    }

    return (
      reactionState.targets.find((target) =>
        reactionTargetMatches(target, {
          targetKind: commentTarget.targetKind,
          assetId: commentTarget.assetId,
        }),
      ) ?? null
    );
  }, [commentTarget.assetId, commentTarget.targetKind, reactionState]);

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
      onFeedback(error instanceof Error ? error.message : 'Kommentar konnte nicht gespeichert werden.');
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentDraft, commentTarget, createComment, onFeedback]);

  const handleSetReaction = useCallback(async () => {
    setIsReacting(true);
    onFeedback(null);

    try {
      const emoji = normalizeReactionEmoji(reactionDraft || '❤️');
      await setReaction({
        shareBatchId: commentTarget.shareBatchId,
        ...(commentTarget.assetId ? { assetId: commentTarget.assetId } : {}),
        emoji,
      });
      setReactionDraft('');
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Reaktion konnte nicht gespeichert werden.');
    } finally {
      setIsReacting(false);
    }
  }, [commentTarget, onFeedback, reactionDraft, setReaction]);

  const handleRemoveReaction = useCallback(async () => {
    setIsReacting(true);
    onFeedback(null);

    try {
      await removeReaction({
        shareBatchId: commentTarget.shareBatchId,
        ...(commentTarget.assetId ? { assetId: commentTarget.assetId } : {}),
      });
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Reaktion konnte nicht entfernt werden.');
    } finally {
      setIsReacting(false);
    }
  }, [commentTarget, onFeedback, removeReaction]);

  const handleDeleteComment = useCallback(
    (comment: CommentRecord) => {
      Alert.alert('Kommentar entfernen?', 'Dieser Kommentar wird für alle Mitglieder entfernt.', [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => {
            onFeedback(null);
            void deleteComment({ commentId: comment._id }).catch((error) => {
              onFeedback(
                error instanceof Error ? error.message : 'Kommentar konnte nicht entfernt werden.',
              );
            });
          },
        },
      ]);
    },
    [deleteComment, onFeedback],
  );

  const targetSummary =
    commentTarget.targetKind === 'asset'
      ? activeAsset?.engagement
      : share.shareTargetEngagement;
  const comments = commentsPage.results;
  const isCommentsLoading = commentsPage.status === 'LoadingFirstPage';
  const hasMoreComments = commentsPage.status !== 'Exhausted';
  const isReactionLoading = reactionState === undefined;
  const isTargetLoading = isCommentsLoading || isReactionLoading;
  const isTargetInvalid = commentTarget.targetKind === 'asset' && !activeAsset;
  const canSubmitComment =
    !isTargetLoading &&
    !isTargetInvalid &&
    !isSubmittingComment &&
    commentDraft.trim().length > 0;
  const canSubmitReaction = !isTargetLoading && !isTargetInvalid && !isReacting;
  const viewerReaction = activeReactionTarget?.viewerReaction ?? null;
  const topReactions = activeReactionTarget?.topReactions ?? targetSummary?.topReactions ?? [];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={84}
      style={[styles.engagementPanel, { backgroundColor: theme.surface }]}
    >
      <View style={styles.engagementHeader}>
        <View style={styles.engagementHeading}>
          <Text style={[styles.engagementTitle, { color: theme.text }]}>Gespräch</Text>
          <Text style={[styles.engagementMeta, { color: theme.textSecondary }]}>
            {targetSummary?.commentCount ?? 0} Kommentare · {targetSummary?.reactionCount ?? 0} Reaktionen
          </Text>
        </View>
        <View style={styles.scopeToggle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Beitrag als Gesprächsfokus wählen"
            onPress={() => setEngagementScope('share')}
            style={[
              styles.scopeButton,
              {
                backgroundColor:
                  engagementScope === 'share' ? theme.primaryMuted : theme.surfacePressed,
              },
            ]}
          >
            <Text
              style={[
                styles.scopeButtonText,
                { color: engagementScope === 'share' ? theme.primary : theme.textSecondary },
              ]}
            >
              Beitrag
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aktuelles Medium als Gesprächsfokus wählen"
            disabled={!activeAsset}
            onPress={() => setEngagementScope('asset')}
            style={[
              styles.scopeButton,
              {
                backgroundColor:
                  engagementScope === 'asset' ? theme.primaryMuted : theme.surfacePressed,
                opacity: activeAsset ? 1 : 0.5,
              },
            ]}
          >
            <Text
              style={[
                styles.scopeButtonText,
                { color: engagementScope === 'asset' ? theme.primary : theme.textSecondary },
              ]}
            >
              Medium
            </Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.targetLabel, { color: theme.textTertiary }]}>
        Fokus: {commentTarget.label}
      </Text>

      <View style={styles.reactionComposer}>
        <View style={styles.reactionSummary}>
          {topReactions.length > 0 ? (
            topReactions.map((reaction) => (
              <View
                key={reaction.emoji}
                style={[
                  styles.reactionChip,
                  {
                    backgroundColor: reaction.reactedByViewer
                      ? theme.accentMuted
                      : theme.surfacePressed,
                  },
                ]}
              >
                <Text style={styles.reactionChipEmoji}>{reaction.emoji}</Text>
                <Text
                  style={[
                    styles.reactionChipCount,
                    { color: reaction.reactedByViewer ? theme.accent : theme.textSecondary },
                  ]}
                >
                  {reaction.count}
                </Text>
              </View>
            ))
          ) : (
            <Text style={[styles.noEngagementText, { color: theme.textTertiary }]}>
              Noch keine Reaktionen.
            </Text>
          )}
        </View>
        <View style={styles.reactionInputRow}>
          <TextInput
            accessibilityLabel="Reaktion"
            value={reactionDraft}
            onChangeText={setReactionDraft}
            placeholder={viewerReaction ?? '❤️'}
            placeholderTextColor={theme.textTertiary}
            style={[
              styles.reactionInput,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.background,
              },
            ]}
            maxLength={8}
            autoCorrect={false}
            returnKeyType="done"
          />
          <Button
            label={viewerReaction ? 'Ändern' : 'Reagieren'}
            icon="heart-outline"
            variant="outline"
            loading={isReacting}
            disabled={!canSubmitReaction}
            onPress={() => {
              void handleSetReaction();
            }}
          />
          {viewerReaction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reaktion entfernen"
              hitSlop={10}
              disabled={isReacting}
              onPress={() => {
                void handleRemoveReaction();
              }}
              style={[styles.removeReactionButton, { backgroundColor: theme.dangerMuted }]}
            >
              <Ionicons name="close" size={16} color={theme.danger} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.commentComposer}>
        <TextInput
          accessibilityLabel="Kommentar schreiben"
          value={commentDraft}
          onChangeText={setCommentDraft}
          placeholder="Antwort schreiben"
          placeholderTextColor={theme.textTertiary}
          multiline
          maxLength={COMMENT_MAX_BODY_LENGTH}
          style={[
            styles.commentInput,
            {
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.background,
            },
          ]}
        />
        <Text style={[styles.commentLimit, { color: theme.textTertiary }]}>
          {commentDraft.length}/{COMMENT_MAX_BODY_LENGTH}
        </Text>
        <Button
          label="Senden"
          icon="send-outline"
          loading={isSubmittingComment}
          disabled={!canSubmitComment}
          onPress={() => {
            void handleSubmitComment();
          }}
        />
      </View>

      <View style={styles.commentsList}>
        {isCommentsLoading ? (
          <LoadingBox />
        ) : comments.length > 0 ? (
          comments.map((comment) => (
            <CommentRow key={comment._id} comment={comment} onDelete={handleDeleteComment} />
          ))
        ) : (
          <Text style={[styles.noEngagementText, { color: theme.textTertiary }]}>
            Noch keine Kommentare in diesem Fokus.
          </Text>
        )}

        {hasMoreComments && comments.length > 0 ? (
          <Button
            label={commentsPage.status === 'LoadingMore' ? 'Lädt...' : 'Mehr laden'}
            icon="chevron-down-outline"
            variant="ghost"
            loading={commentsPage.status === 'LoadingMore'}
            onPress={() => commentsPage.loadMore(20)}
          />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  engagementPanel: {
    borderRadius: Radius.xl,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  engagementHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  engagementHeading: {
    flex: 1,
    minWidth: 180,
  },
  engagementTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  engagementMeta: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  scopeToggle: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  scopeButton: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  scopeButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  targetLabel: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  reactionComposer: {
    gap: Spacing.sm,
  },
  reactionSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reactionChipEmoji: {
    fontSize: FontSize.base,
    lineHeight: 18,
  },
  reactionChipCount: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  reactionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  reactionInput: {
    width: 54,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.lg,
    fontSize: FontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  removeReactionButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentComposer: {
    gap: Spacing.sm,
  },
  commentInput: {
    minHeight: 82,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  commentLimit: {
    alignSelf: 'flex-end',
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
  },
  commentsList: {
    gap: Spacing.sm,
  },
  commentRow: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    gap: Spacing.xs,
    padding: Spacing.md,
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
  commentDelete: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  commentDeleteText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  noEngagementText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
