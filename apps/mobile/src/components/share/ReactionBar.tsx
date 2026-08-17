import Ionicons from '@expo/vector-icons/Ionicons';
import { useGT } from 'gt-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { useMutation, useQuery } from 'convex/react';

import { AnimatedPressable } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { api } from '@/features/convex/api';
import { normalizeReactionEmoji } from '@/features/engagement/validation';
import { useTheme } from '@/hooks/use-theme';

/** One-tap examples; any other emoji works via the "+" chip. */
const QUICK_EMOJIS = ['❤️', '😂', '🥰', '👏'];

/**
 * Share-level reactions as a single tap row: tap an emoji to react, tap your
 * active one to take it back, or open the "+" chip to react with any emoji.
 */
export const ReactionBar = memo(function ReactionBar({
  onFeedback,
  shareBatchId,
}: {
  onFeedback: (message: string | null) => void;
  shareBatchId: string;
}) {
  const theme = useTheme();
  const gt = useGT();
  const reactionState = useQuery(api.reactions.listForShare, { shareBatchId });
  const setReaction = useMutation(api.reactions.set);
  const removeReaction = useMutation(api.reactions.remove);
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');

  const shareTarget = useMemo(
    () =>
      reactionState?.targets.find(
        (target) => target.targetKind === 'share' && target.assetId === null,
      ) ?? null,
    [reactionState],
  );
  const viewerReaction = shareTarget?.viewerReaction ?? null;

  const emojis = useMemo(() => {
    const merged = [...QUICK_EMOJIS];
    for (const reaction of shareTarget?.topReactions ?? []) {
      if (!merged.includes(reaction.emoji)) {
        merged.push(reaction.emoji);
      }
    }
    if (viewerReaction && !merged.includes(viewerReaction)) {
      merged.push(viewerReaction);
    }
    return merged;
  }, [shareTarget?.topReactions, viewerReaction]);

  const countFor = useCallback(
    (emoji: string) =>
      shareTarget?.topReactions.find((reaction) => reaction.emoji === emoji)?.count ?? 0,
    [shareTarget?.topReactions],
  );

  const applyReaction = useCallback(
    async (emoji: string, remove: boolean) => {
      setPendingEmoji(emoji);
      onFeedback(null);

      try {
        if (remove) {
          await removeReaction({ shareBatchId });
        } else {
          await setReaction({ shareBatchId, emoji });
        }
        setIsCustomOpen(false);
        setCustomDraft('');
      } catch (error) {
        onFeedback(
          error instanceof Error ? error.message : gt('Reaktion konnte nicht gespeichert werden.'),
        );
      } finally {
        setPendingEmoji(null);
      }
    },
    [gt, onFeedback, removeReaction, setReaction, shareBatchId],
  );

  const handleToggle = useCallback(
    (emoji: string) => {
      void applyReaction(emoji, viewerReaction === emoji);
    },
    [applyReaction, viewerReaction],
  );

  const handleCustomSubmit = useCallback(() => {
    onFeedback(null);

    let emoji: string;
    try {
      emoji = normalizeReactionEmoji(customDraft);
    } catch {
      onFeedback(gt('Bitte gib genau ein Emoji ein.'));
      return;
    }

    void applyReaction(emoji, false);
  }, [applyReaction, customDraft, gt, onFeedback]);

  const isLoading = reactionState === undefined;
  const isBusy = isLoading || pendingEmoji !== null;

  return (
    <View style={styles.row}>
      {emojis.map((emoji) => {
        const count = countFor(emoji);
        const isActive = viewerReaction === emoji;
        const isPending = pendingEmoji === emoji;

        return (
          <AnimatedPressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={
              isActive
                ? gt('Reaktion {emoji} entfernen', { emoji })
                : gt('Mit {emoji} reagieren', { emoji })
            }
            disabled={isBusy}
            onPress={() => handleToggle(emoji)}
            pressedScale={0.92}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? theme.accentMuted : theme.surfacePressed,
                borderColor: isActive ? theme.accent : 'transparent',
              },
            ]}
          >
            {isPending ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <>
                <Text style={styles.emoji}>{emoji}</Text>
                {count > 0 ? (
                  <Text
                    style={[
                      styles.count,
                      { color: isActive ? theme.accent : theme.textSecondary },
                    ]}
                  >
                    {count}
                  </Text>
                ) : null}
              </>
            )}
          </AnimatedPressable>
        );
      })}

      {isCustomOpen ? (
        <View style={styles.customRow}>
          <TextInput
            accessibilityLabel={gt('Eigenes Emoji')}
            value={customDraft}
            onChangeText={setCustomDraft}
            placeholder="😊"
            placeholderTextColor={theme.textTertiary}
            autoFocus
            autoCorrect={false}
            maxLength={8}
            returnKeyType="done"
            onSubmitEditing={handleCustomSubmit}
            style={[
              styles.customInput,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.background,
              },
            ]}
          />
          {customDraft.trim().length > 0 ? (
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={gt('Mit eigenem Emoji reagieren')}
              disabled={isBusy}
              onPress={handleCustomSubmit}
              pressedScale={0.92}
              style={[styles.customButton, { backgroundColor: theme.primary }]}
            >
              <Ionicons name="checkmark" size={16} color={theme.primaryText} />
            </AnimatedPressable>
          ) : null}
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={gt('Eingabe schließen')}
            onPress={() => {
              setIsCustomOpen(false);
              setCustomDraft('');
            }}
            pressedScale={0.92}
            style={[styles.customButton, { backgroundColor: theme.surfacePressed }]}
          >
            <Ionicons name="close" size={16} color={theme.textSecondary} />
          </AnimatedPressable>
        </View>
      ) : (
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={gt('Mit einem beliebigen Emoji reagieren')}
          disabled={isBusy}
          onPress={() => setIsCustomOpen(true)}
          pressedScale={0.92}
          style={[styles.chip, { backgroundColor: theme.surfacePressed, borderColor: 'transparent' }]}
        >
          <Ionicons name="add" size={17} color={theme.textSecondary} />
        </AnimatedPressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 44,
    minHeight: 36,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  emoji: {
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  count: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  customInput: {
    width: 56,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 4,
    fontSize: FontSize.md,
    textAlign: 'center',
  },
  customButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
