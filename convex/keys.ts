import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { canManageCircle } from './lib/permissions';
import { findViewer, requireCircleMembership, requireViewer } from './lib/viewer';

export const keyFunctionSurface = [
  'keys.getMyKeys',
  'keys.registerKeys',
  'keys.getCircleMemberPublicKeys',
  'keys.getMyCircleKeys',
  'keys.initializeCircleKey',
  'keys.grantCircleKeys',
  'keys.rotateCircleKey',
  'keys.listMissingKeyGrants',
] as const;

export const SUPPORTED_USER_KEY_VERSION = 1;

/** Epochs per circle stay tiny (one per rotation), so a bounded read is fine. */
const CIRCLE_KEY_EPOCH_LIMIT = 500;
// Mirrors circles.CIRCLE_MEMBER_LIST_LIMIT (not imported to avoid a module cycle).
const CIRCLE_MEMBER_LIST_LIMIT = 200;
const GRANT_BATCH_LIMIT = CIRCLE_MEMBER_LIST_LIMIT;

const grantInputValidator = v.object({
  userId: v.id('users'),
  sealedCircleKey: v.string(),
});

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmed;
}

async function getCurrentEpoch(
  ctx: QueryCtx | MutationCtx,
  circleId: Id<'circles'>,
): Promise<Doc<'circleKeyEpochs'> | null> {
  return await ctx.db
    .query('circleKeyEpochs')
    .withIndex('by_circle_and_epoch', (q) => q.eq('circleId', circleId))
    .order('desc')
    .first();
}

async function getGrant(
  ctx: QueryCtx | MutationCtx,
  circleId: Id<'circles'>,
  userId: Id<'users'>,
  epoch: number,
): Promise<Doc<'circleKeyGrants'> | null> {
  return await ctx.db
    .query('circleKeyGrants')
    .withIndex('by_circle_and_user_and_epoch', (q) =>
      q.eq('circleId', circleId).eq('userId', userId).eq('epoch', epoch),
    )
    .unique();
}

async function insertGrants(
  ctx: MutationCtx,
  input: {
    circleId: Id<'circles'>;
    epoch: number;
    grantedBy: Id<'users'>;
    grants: Array<{ userId: Id<'users'>; sealedCircleKey: string }>;
  },
): Promise<number> {
  if (input.grants.length > GRANT_BATCH_LIMIT) {
    throw new Error(`At most ${GRANT_BATCH_LIMIT} grants can be written per call.`);
  }

  const now = Date.now();
  const seenUserIds = new Set<string>();
  let inserted = 0;

  for (const grant of input.grants) {
    if (seenUserIds.has(grant.userId)) {
      throw new Error('Duplicate grant target.');
    }

    seenUserIds.add(grant.userId);
    requireNonEmpty(grant.sealedCircleKey, 'sealedCircleKey');

    const targetMembership = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle_and_user', (q) =>
        q.eq('circleId', input.circleId).eq('userId', grant.userId),
      )
      .unique();

    if (!targetMembership) {
      throw new Error('Grants can only target current circle members.');
    }

    const existing = await getGrant(ctx, input.circleId, grant.userId, input.epoch);

    if (existing) {
      continue;
    }

    await ctx.db.insert('circleKeyGrants', {
      circleId: input.circleId,
      epoch: input.epoch,
      userId: grant.userId,
      grantedBy: input.grantedBy,
      sealedCircleKey: grant.sealedCircleKey.trim(),
      createdAt: now,
    });
    inserted += 1;
  }

  return inserted;
}

/** Removes a departing member's grants; called from removeMember/leave/account deletion. */
export async function deleteCircleKeyGrantsForMember(
  ctx: MutationCtx,
  circleId: Id<'circles'>,
  userId: Id<'users'>,
): Promise<void> {
  const grants = await ctx.db
    .query('circleKeyGrants')
    .withIndex('by_circle_and_user_and_epoch', (q) =>
      q.eq('circleId', circleId).eq('userId', userId),
    )
    .take(CIRCLE_KEY_EPOCH_LIMIT);

  for (const grant of grants) {
    await ctx.db.delete(grant._id);
  }
}

export const getMyKeys = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      keyVersion: v.number(),
      publicKey: v.string(),
      encPrivateKey: v.string(),
      encMasterKeyByRecovery: v.string(),
      encRecoveryKeyByMaster: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await findViewer(ctx);

    if (!viewer) {
      return null;
    }

    const keys = await ctx.db
      .query('userKeys')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique();

    if (!keys) {
      return null;
    }

    return {
      keyVersion: keys.keyVersion,
      publicKey: keys.publicKey,
      encPrivateKey: keys.encPrivateKey,
      encMasterKeyByRecovery: keys.encMasterKeyByRecovery,
      encRecoveryKeyByMaster: keys.encRecoveryKeyByMaster,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
    };
  },
});

export const registerKeys = mutation({
  args: {
    keyVersion: v.number(),
    publicKey: v.string(),
    encPrivateKey: v.string(),
    encMasterKeyByRecovery: v.string(),
    encRecoveryKeyByMaster: v.string(),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    if (args.keyVersion !== SUPPORTED_USER_KEY_VERSION) {
      throw new Error(`Unsupported key version ${args.keyVersion}.`);
    }

    const publicKey = requireNonEmpty(args.publicKey, 'publicKey');
    const encPrivateKey = requireNonEmpty(args.encPrivateKey, 'encPrivateKey');
    const encMasterKeyByRecovery = requireNonEmpty(
      args.encMasterKeyByRecovery,
      'encMasterKeyByRecovery',
    );
    const encRecoveryKeyByMaster = requireNonEmpty(
      args.encRecoveryKeyByMaster,
      'encRecoveryKeyByMaster',
    );
    const existing = await ctx.db
      .query('userKeys')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique();

    if (existing) {
      // Idempotent re-registration of the same keys (e.g. a retried call);
      // anything else would orphan every sealed grant, so it is rejected
      // until an explicit, re-encrypting key-reset flow exists.
      if (existing.publicKey === publicKey) {
        return { created: false };
      }

      throw new Error(
        'Keys are already registered for this account. Use the recovery code on new devices.',
      );
    }

    const now = Date.now();

    await ctx.db.insert('userKeys', {
      userId: viewer._id,
      keyVersion: args.keyVersion,
      publicKey,
      encPrivateKey,
      encMasterKeyByRecovery,
      encRecoveryKeyByMaster,
      createdAt: now,
      updatedAt: now,
    });

    return { created: true };
  },
});

export const getCircleMemberPublicKeys = query({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.array(
    v.object({
      userId: v.id('users'),
      publicKey: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .take(CIRCLE_MEMBER_LIST_LIMIT);
    const members = [];

    for (const membership of memberships) {
      const keys = await ctx.db
        .query('userKeys')
        .withIndex('by_user', (q) => q.eq('userId', membership.userId))
        .unique();

      members.push({
        userId: membership.userId,
        publicKey: keys?.publicKey ?? null,
      });
    }

    return members;
  },
});

export const getMyCircleKeys = query({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.object({
    currentEpoch: v.union(v.number(), v.null()),
    grants: v.array(
      v.object({
        epoch: v.number(),
        sealedCircleKey: v.string(),
        grantedBy: v.id('users'),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const currentEpoch = await getCurrentEpoch(ctx, args.circleId);
    const grants = await ctx.db
      .query('circleKeyGrants')
      .withIndex('by_circle_and_user_and_epoch', (q) =>
        q.eq('circleId', args.circleId).eq('userId', viewer._id),
      )
      .take(CIRCLE_KEY_EPOCH_LIMIT);

    return {
      currentEpoch: currentEpoch?.epoch ?? null,
      grants: grants.map((grant) => ({
        epoch: grant.epoch,
        sealedCircleKey: grant.sealedCircleKey,
        grantedBy: grant.grantedBy,
        createdAt: grant.createdAt,
      })),
    };
  },
});

export const initializeCircleKey = mutation({
  args: {
    circleId: v.id('circles'),
    sealedCircleKey: v.string(),
  },
  returns: v.object({ epoch: v.number(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const existing = await getCurrentEpoch(ctx, args.circleId);

    if (existing) {
      // Concurrent initialization by two members: first writer wins, the
      // loser re-reads and requests a grant instead of forking the key.
      return { epoch: existing.epoch, created: false };
    }

    await ctx.db.insert('circleKeyEpochs', {
      circleId: args.circleId,
      epoch: 1,
      reason: 'initial',
      createdBy: viewer._id,
      createdAt: Date.now(),
    });
    await insertGrants(ctx, {
      circleId: args.circleId,
      epoch: 1,
      grantedBy: viewer._id,
      grants: [{ userId: viewer._id, sealedCircleKey: args.sealedCircleKey }],
    });

    return { epoch: 1, created: true };
  },
});

export const grantCircleKeys = mutation({
  args: {
    circleId: v.id('circles'),
    epoch: v.number(),
    grants: v.array(grantInputValidator),
  },
  returns: v.object({ granted: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const epochRow = await ctx.db
      .query('circleKeyEpochs')
      .withIndex('by_circle_and_epoch', (q) =>
        q.eq('circleId', args.circleId).eq('epoch', args.epoch),
      )
      .unique();

    if (!epochRow) {
      throw new Error('Unknown circle key epoch.');
    }

    // Only holders of the epoch key can have produced valid sealed grants.
    const viewerGrant = await getGrant(ctx, args.circleId, viewer._id, args.epoch);

    if (!viewerGrant) {
      throw new Error('Only members holding this circle key can grant it.');
    }

    const granted = await insertGrants(ctx, {
      circleId: args.circleId,
      epoch: args.epoch,
      grantedBy: viewer._id,
      grants: args.grants,
    });

    return { granted };
  },
});

export const rotateCircleKey = mutation({
  args: {
    circleId: v.id('circles'),
    grants: v.array(grantInputValidator),
  },
  returns: v.object({ epoch: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!canManageCircle(membership.role)) {
      throw new Error('Only owners and admins can rotate the circle key.');
    }

    const current = await getCurrentEpoch(ctx, args.circleId);

    if (!current) {
      throw new Error('Initialize the circle key before rotating it.');
    }

    if (!args.grants.some((grant) => grant.userId === viewer._id)) {
      throw new Error('Rotation must include a grant for the rotating member.');
    }

    const epoch = current.epoch + 1;

    await ctx.db.insert('circleKeyEpochs', {
      circleId: args.circleId,
      epoch,
      reason: 'rotation',
      createdBy: viewer._id,
      createdAt: Date.now(),
    });
    await insertGrants(ctx, {
      circleId: args.circleId,
      epoch,
      grantedBy: viewer._id,
      grants: args.grants,
    });

    return { epoch };
  },
});

export const listMissingKeyGrants = query({
  args: {
    circleId: v.id('circles'),
  },
  returns: v.object({
    currentEpoch: v.union(v.number(), v.null()),
    missing: v.array(
      v.object({
        userId: v.id('users'),
        publicKey: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const currentEpoch = await getCurrentEpoch(ctx, args.circleId);

    if (!currentEpoch) {
      return { currentEpoch: null, missing: [] };
    }

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .take(CIRCLE_MEMBER_LIST_LIMIT);
    const missing = [];

    for (const membership of memberships) {
      const grant = await getGrant(ctx, args.circleId, membership.userId, currentEpoch.epoch);

      if (grant) {
        continue;
      }

      const keys = await ctx.db
        .query('userKeys')
        .withIndex('by_user', (q) => q.eq('userId', membership.userId))
        .unique();

      missing.push({
        userId: membership.userId,
        publicKey: keys?.publicKey ?? null,
      });
    }

    return { currentEpoch: currentEpoch.epoch, missing };
  },
});
