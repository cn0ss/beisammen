import type {
  EngagementReactionSummary,
  EngagementSummary,
} from '@beisammen/contracts';
import { REACTION_TOP_EMOJI_LIMIT } from '@beisammen/contracts';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import { requireCircleMembership } from './viewer';

export const ENGAGEMENT_SUMMARY_ROW_LIMIT = 500;

export function engagementTargetKey(assetId?: Id<'assets'> | null): string {
  return assetId ? `asset:${assetId}` : 'share';
}

export function engagementTargetKind(assetId?: Id<'assets'> | null): 'share' | 'asset' {
  return assetId ? 'asset' : 'share';
}

export async function requirePublishedEngagementTarget(
  ctx: QueryCtx | MutationCtx,
  input: {
    viewerId: Id<'users'>;
    shareBatchId: Id<'shareBatches'>;
    assetId?: Id<'assets'>;
  },
): Promise<{
  shareBatch: Doc<'shareBatches'>;
  targetKind: 'share' | 'asset';
  targetKey: string;
  assetId: Id<'assets'> | null;
  membership: Doc<'circleMembers'>;
}> {
  const shareBatch = await ctx.db.get(input.shareBatchId);

  if (!shareBatch) {
    throw new Error('Share not found.');
  }

  const membership = await requireCircleMembership(ctx, input.viewerId, shareBatch.circleId);

  if (shareBatch.status !== 'published') {
    throw new Error('Only published shares can receive engagement.');
  }

  if (input.assetId) {
    const asset = await ctx.db.get(input.assetId);

    if (
      !asset ||
      asset.shareBatchId !== shareBatch._id ||
      asset.circleId !== shareBatch.circleId
    ) {
      throw new Error('Asset does not belong to this share.');
    }
  }

  return {
    shareBatch,
    targetKind: engagementTargetKind(input.assetId),
    targetKey: engagementTargetKey(input.assetId),
    assetId: input.assetId ?? null,
    membership,
  };
}

function emptyEngagementSummary(): EngagementSummary {
  return {
    commentCount: 0,
    reactionCount: 0,
    topReactions: [],
  };
}

function summarizeReactions(
  reactions: Doc<'reactions'>[],
  viewerId: Id<'users'>,
): {
  reactionCount: number;
  viewerReaction: string | null;
  topReactions: EngagementReactionSummary[];
} {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let viewerReaction: string | null = null;

  for (const [index, reaction] of reactions.entries()) {
    if (!firstSeen.has(reaction.emoji)) {
      firstSeen.set(reaction.emoji, index);
    }

    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1);

    if (reaction.userId === viewerId) {
      viewerReaction = reaction.emoji;
    }
  }

  const topReactions = Array.from(counts.entries())
    .sort(([leftEmoji, leftCount], [rightEmoji, rightCount]) => {
      const countDelta = rightCount - leftCount;
      return countDelta !== 0
        ? countDelta
        : (firstSeen.get(leftEmoji) ?? 0) - (firstSeen.get(rightEmoji) ?? 0);
    })
    .slice(0, REACTION_TOP_EMOJI_LIMIT)
    .map(([emoji, count]) => ({
      emoji,
      count,
      reactedByViewer: viewerReaction === emoji,
    }));

  return {
    reactionCount: reactions.length,
    viewerReaction,
    topReactions,
  };
}

export async function buildTargetEngagementSummary(
  ctx: QueryCtx | MutationCtx,
  input: {
    shareBatchId: Id<'shareBatches'>;
    targetKey: string;
    viewerId: Id<'users'>;
  },
): Promise<EngagementSummary> {
  const comments = await ctx.db
    .query('comments')
    .withIndex('by_share_target_status_created_at', (q) =>
      q
        .eq('shareBatchId', input.shareBatchId)
        .eq('targetKey', input.targetKey)
        .eq('status', 'active'),
    )
    .take(ENGAGEMENT_SUMMARY_ROW_LIMIT);
  const reactions = await ctx.db
    .query('reactions')
    .withIndex('by_share_target', (q) =>
      q.eq('shareBatchId', input.shareBatchId).eq('targetKey', input.targetKey),
    )
    .take(ENGAGEMENT_SUMMARY_ROW_LIMIT);
  const reactionSummary = summarizeReactions(reactions, input.viewerId);

  return {
    commentCount: comments.length,
    reactionCount: reactionSummary.reactionCount,
    topReactions: reactionSummary.topReactions,
  };
}

export async function buildShareEngagementSummary(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
  viewerId: Id<'users'>,
): Promise<EngagementSummary> {
  const comments = await ctx.db
    .query('comments')
    .withIndex('by_share_batch_and_status', (q) =>
      q.eq('shareBatchId', shareBatchId).eq('status', 'active'),
    )
    .take(ENGAGEMENT_SUMMARY_ROW_LIMIT);
  const reactions = await ctx.db
    .query('reactions')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))
    .take(ENGAGEMENT_SUMMARY_ROW_LIMIT);
  const reactionSummary = summarizeReactions(reactions, viewerId);

  return {
    commentCount: comments.length,
    reactionCount: reactionSummary.reactionCount,
    topReactions: reactionSummary.topReactions,
  };
}

export async function buildAssetEngagementSummaries(
  ctx: QueryCtx | MutationCtx,
  input: {
    shareBatchId: Id<'shareBatches'>;
    assetIds: Id<'assets'>[];
    viewerId: Id<'users'>;
  },
): Promise<Map<Id<'assets'>, EngagementSummary>> {
  const summaries = new Map<Id<'assets'>, EngagementSummary>();

  for (const assetId of input.assetIds) {
    summaries.set(
      assetId,
      await buildTargetEngagementSummary(ctx, {
        shareBatchId: input.shareBatchId,
        targetKey: engagementTargetKey(assetId),
        viewerId: input.viewerId,
      }),
    );
  }

  return summaries;
}

export async function listReactionTargetsForShare(
  ctx: QueryCtx | MutationCtx,
  input: {
    shareBatchId: Id<'shareBatches'>;
    viewerId: Id<'users'>;
  },
) {
  const reactions = await ctx.db
    .query('reactions')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', input.shareBatchId))
    .take(ENGAGEMENT_SUMMARY_ROW_LIMIT);
  const grouped = new Map<string, Doc<'reactions'>[]>();

  for (const reaction of reactions) {
    const rows = grouped.get(reaction.targetKey) ?? [];
    rows.push(reaction);
    grouped.set(reaction.targetKey, rows);
  }

  return Array.from(grouped.entries())
    .map(([targetKey, rows]) => {
      const first = rows[0];
      const reactionSummary = summarizeReactions(rows, input.viewerId);

      return first
        ? {
            targetKind: first.targetKind,
            assetId: first.assetId ?? null,
            reactionCount: reactionSummary.reactionCount,
            viewerReaction: reactionSummary.viewerReaction,
            topReactions: reactionSummary.topReactions,
          }
        : null;
    })
    .filter((target): target is NonNullable<typeof target> => target !== null)
    .sort((left, right) => {
      if (left.targetKind !== right.targetKind) {
        return left.targetKind === 'share' ? -1 : 1;
      }

      return (left.assetId ?? '').localeCompare(right.assetId ?? '');
    });
}

export function fallbackEngagementSummary(value?: EngagementSummary): EngagementSummary {
  return value ?? emptyEngagementSummary();
}
