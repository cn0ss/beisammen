import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import type { CircleRole } from './permissions';

/**
 * Returns the authenticated viewer's profile, or null while the profile row
 * has not been created yet (the first-sign-in bootstrap window before
 * `users.upsertFromIdentity` commits). Queries that are subscribed during
 * app startup should tolerate this window instead of throwing.
 */
export async function findViewer(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error('Authenticated user required.');
  }

  return await ctx.db
    .query('users')
    .withIndex('by_token_identifier', (q) =>
      q.eq('tokenIdentifier', identity.tokenIdentifier),
    )
    .unique();
}

export async function requireViewer(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<'users'>> {
  const viewer = await findViewer(ctx);

  if (!viewer) {
    throw new Error('Viewer profile not found.');
  }

  return viewer;
}

export async function getViewerMembership(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  circleId: Id<'circles'>,
): Promise<Doc<'circleMembers'> | null> {
  return await ctx.db
    .query('circleMembers')
    .withIndex('by_circle_and_user', (q) =>
      q.eq('circleId', circleId).eq('userId', userId),
    )
    .unique();
}

export async function requireCircleMembership(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  circleId: Id<'circles'>,
): Promise<Doc<'circleMembers'>> {
  const membership = await getViewerMembership(ctx, userId, circleId);

  if (!membership) {
    throw new Error('Circle membership required.');
  }

  return membership;
}

export function isManageRole(role: CircleRole): boolean {
  return role === 'owner' || role === 'admin';
}
