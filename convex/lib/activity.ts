import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const ACTIVITY_INBOX_RECIPIENT_LIMIT = 200;

export async function createActivityEventWithInbox(
  ctx: MutationCtx,
  input: {
    circleId: Id<'circles'>;
    actorId: Id<'users'>;
    type: string;
    shareBatchId: Id<'shareBatches'>;
    assetId?: Id<'assets'>;
    commentId?: Id<'comments'>;
    reactionId?: Id<'reactions'>;
    createdAt: number;
  },
) {
  const activityEventId = await ctx.db.insert('activityEvents', {
    circleId: input.circleId,
    actorId: input.actorId,
    type: input.type,
    entityId: input.shareBatchId,
    shareBatchId: input.shareBatchId,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.commentId ? { commentId: input.commentId } : {}),
    ...(input.reactionId ? { reactionId: input.reactionId } : {}),
    createdAt: input.createdAt,
  });
  const members = await ctx.db
    .query('circleMembers')
    .withIndex('by_circle', (q) => q.eq('circleId', input.circleId))
    .take(ACTIVITY_INBOX_RECIPIENT_LIMIT);

  for (const membership of members) {
    if (membership.userId === input.actorId) {
      continue;
    }

    await ctx.db.insert('activityInboxItems', {
      activityEventId,
      userId: membership.userId,
      circleId: input.circleId,
      actorId: input.actorId,
      type: input.type,
      shareBatchId: input.shareBatchId,
      ...(input.assetId ? { assetId: input.assetId } : {}),
      status: 'unread',
      createdAt: input.createdAt,
    });
  }

  return { activityEventId };
}
