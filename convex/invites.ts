import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { isManageRole, requireCircleMembership, requireViewer } from './lib/viewer';

export const inviteFunctionSurface = [
  'invites.create',
  'invites.listForCircle',
  'invites.preview',
  'invites.accept',
  'invites.revoke',
] as const;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function readBaseUrl(): string {
  const configured =
    process.env.INSTANCE_BASE_URL ??
    process.env.CONVEX_SITE_URL ??
    process.env.CONVEX_SITE_ORIGIN ??
    'http://127.0.0.1:3211';

  return trimTrailingSlashes(configured);
}

function buildInviteLink(token: string): string {
  const params = new URLSearchParams({
    instance: readBaseUrl(),
    invite: token,
  });

  return `beisammen://connect?${params.toString()}`;
}

function buildInvitedByLabel(user: Doc<'users'> | null) {
  if (!user) {
    return 'Unbekannte Person';
  }

  return user.displayName?.trim() || user.email?.trim() || 'Unbekannte Person';
}

export const create = mutation({
  args: {
    circleId: v.id('circles'),
    invitedEmail: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isManageRole(membership.role)) {
      throw new Error('Only owners and admins can invite people.');
    }

    const now = Date.now();
    const token = crypto.randomUUID();
    const inviteId = await ctx.db.insert('invites', {
      circleId: args.circleId,
      invitedEmail: args.invitedEmail.trim().toLowerCase(),
      role: args.role,
      tokenHash: token,
      status: 'pending',
      invitedBy: viewer._id,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    return {
      inviteId,
      token,
      inviteLink: buildInviteLink(token),
    };
  },
});

export const listForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);
    const invites = await ctx.db
      .query('invites')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .collect();

    const rows = await Promise.all(
      invites.map(async (invite) => {
        const inviter = await ctx.db.get(invite.invitedBy);
        const isExpired = invite.status === 'pending' && invite.expiresAt < Date.now();
        const resolvedStatus = isExpired ? 'expired' : invite.status;

        return {
          _id: invite._id,
          circleId: invite.circleId,
          invitedEmail: invite.invitedEmail,
          role: invite.role,
          status: resolvedStatus,
          expiresAt: invite.expiresAt,
          acceptedAt: invite.acceptedAt ?? null,
          invitedBy: {
            userId: invite.invitedBy,
            displayName: buildInvitedByLabel(inviter),
          },
          canRevoke: isManageRole(membership.role) && resolvedStatus === 'pending',
        };
      }),
    );

    return rows.sort((left, right) => right.expiresAt - left.expiresAt);
  },
});

export const preview = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const invite = await ctx.db
      .query('invites')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', args.token))
      .unique();

    if (!invite) {
      return null;
    }

    const circle = await ctx.db.get(invite.circleId);

    if (!circle) {
      return null;
    }

    const status =
      invite.status === 'pending' && invite.expiresAt < Date.now() ? 'expired' : invite.status;
    const viewerEmail = viewer.email?.trim().toLowerCase();
    const invitedEmail = invite.invitedEmail.trim().toLowerCase();

    return {
      inviteId: invite._id,
      circleId: invite.circleId,
      circleName: circle.name,
      invitedEmail: invite.invitedEmail,
      role: invite.role,
      status,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt ?? null,
      canAccept: status === 'pending' && Boolean(viewerEmail) && viewerEmail === invitedEmail,
      emailMatchesViewer: Boolean(viewerEmail) && viewerEmail === invitedEmail,
    };
  },
});

export const accept = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const invite = await ctx.db
      .query('invites')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', args.token))
      .unique();

    if (!invite) {
      throw new Error('Invite not found.');
    }

    if (invite.status !== 'pending') {
      throw new Error('Invite is no longer pending.');
    }

    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, {
        status: 'expired',
      });
      throw new Error('Invite has expired.');
    }

    if (!viewer.email || viewer.email.toLowerCase() !== invite.invitedEmail) {
      throw new Error('Invite email does not match the current account.');
    }

    const existingMembership = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle_and_user', (q) =>
        q.eq('circleId', invite.circleId).eq('userId', viewer._id),
      )
      .unique();

    if (!existingMembership) {
      await ctx.db.insert('circleMembers', {
        circleId: invite.circleId,
        userId: viewer._id,
        role: invite.role,
        joinedAt: Date.now(),
      });
    }

    await ctx.db.patch(invite._id, {
      status: 'accepted',
      acceptedAt: Date.now(),
    });

    return {
      inviteId: invite._id,
      circleId: invite.circleId,
    };
  },
});

export const revoke = mutation({
  args: {
    inviteId: v.id('invites'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const invite = await ctx.db.get(args.inviteId);

    if (!invite) {
      throw new Error('Invite not found.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, invite.circleId);

    if (!isManageRole(membership.role)) {
      throw new Error('Only owners and admins can revoke invites.');
    }

    await ctx.db.patch(invite._id, {
      status: 'revoked',
    });

    return {
      inviteId: invite._id,
    };
  },
});
