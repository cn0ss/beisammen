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
  'keys.rejectMyKeyGrant',
  'keys.resetKeys',
  'keys.listMissingKeyGrants',
] as const;

export const SUPPORTED_USER_KEY_VERSION = 1;

/** Epochs per circle stay tiny (one per rotation), so a bounded read is fine. */
const CIRCLE_KEY_EPOCH_LIMIT = 500;
// Mirrors circles.CIRCLE_MEMBER_LIST_LIMIT (not imported to avoid a module cycle).
const CIRCLE_MEMBER_LIST_LIMIT = 200;
const GRANT_BATCH_LIMIT = CIRCLE_MEMBER_LIST_LIMIT;
/**
 * Epochs a single listMissingKeyGrants call inspects. Bounds the read volume
 * (epochs x members); clients pass their newest held epochs first, so older
 * history tops up across sessions in the extremely unlikely case a circle
 * accumulates more epochs than this.
 */
export const MISSING_GRANTS_EPOCH_LIMIT = 20;

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

const X25519_PUBLIC_KEY_BYTES = 32;
/** crypto_box_seal output for a 32-byte circle key: 48 bytes overhead + key. */
const SEALED_CIRCLE_KEY_BYTES = 48 + 32;

/**
 * Requires standard base64 (with padding) of exactly `byteLength` bytes.
 * Key material is written by clients but consumed by *other* members'
 * clients, so a malformed value stored here would poison their batch
 * grant/rotation flows; the shape is validated at this trust boundary.
 */
function requireBase64OfBytes(value: string, byteLength: number, fieldName: string): string {
  const trimmed = requireNonEmpty(value, fieldName);
  const paddingChars = (3 - (byteLength % 3)) % 3;
  const dataChars = Math.ceil(byteLength / 3) * 4 - paddingChars;
  const pattern = new RegExp(`^[A-Za-z0-9+/]{${dataChars}}={${paddingChars}}$`);

  if (!pattern.test(trimmed)) {
    throw new Error(`${fieldName} must be base64 of exactly ${byteLength} bytes.`);
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
    requireBase64OfBytes(grant.sealedCircleKey, SEALED_CIRCLE_KEY_BYTES, 'sealedCircleKey');

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

/**
 * Marks the circle as requiring a key rotation after a member departure.
 * While set, encrypted upload completion is rejected, so no post-departure
 * media can be sealed under an epoch the departed member still holds; the
 * next manage-role client commits a fresh epoch and clears the flag.
 */
export async function markCircleKeyRotationPending(
  ctx: MutationCtx,
  circleId: Id<'circles'>,
): Promise<void> {
  const current = await getCurrentEpoch(ctx, circleId);

  if (!current) {
    // The circle never had a key, so the departed member holds nothing.
    return;
  }

  await ctx.db.patch(circleId, { keyRotationPendingAt: Date.now() });
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

const registrationArgs = {
  keyVersion: v.number(),
  publicKey: v.string(),
  encPrivateKey: v.string(),
  encMasterKeyByRecovery: v.string(),
  encRecoveryKeyByMaster: v.string(),
};

interface ValidatedRegistration {
  publicKey: string;
  encPrivateKey: string;
  encMasterKeyByRecovery: string;
  encRecoveryKeyByMaster: string;
}

function validateRegistration(args: {
  keyVersion: number;
  publicKey: string;
  encPrivateKey: string;
  encMasterKeyByRecovery: string;
  encRecoveryKeyByMaster: string;
}): ValidatedRegistration {
  if (args.keyVersion !== SUPPORTED_USER_KEY_VERSION) {
    throw new Error(`Unsupported key version ${args.keyVersion}.`);
  }

  return {
    publicKey: requireBase64OfBytes(args.publicKey, X25519_PUBLIC_KEY_BYTES, 'publicKey'),
    encPrivateKey: requireNonEmpty(args.encPrivateKey, 'encPrivateKey'),
    encMasterKeyByRecovery: requireNonEmpty(
      args.encMasterKeyByRecovery,
      'encMasterKeyByRecovery',
    ),
    encRecoveryKeyByMaster: requireNonEmpty(
      args.encRecoveryKeyByMaster,
      'encRecoveryKeyByMaster',
    ),
  };
}

export const registerKeys = mutation({
  args: registrationArgs,
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const validated = validateRegistration(args);
    const existing = await ctx.db
      .query('userKeys')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique();

    if (existing) {
      // Idempotent re-registration of the same keys (e.g. a retried call);
      // anything else would orphan every sealed grant, so it is rejected.
      // Replacing keys is only possible through the explicit resetKeys flow.
      if (existing.publicKey === validated.publicKey) {
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
      ...validated,
      createdAt: now,
      updatedAt: now,
    });

    return { created: true };
  },
});

/**
 * Last-resort key replacement for a user who lost both their devices and
 * their recovery code. Replaces the registered key material and deletes every
 * grant sealed to the old public key (unreadable by the new keypair anyway),
 * so the user reappears in listMissingKeyGrants and any key-holding member's
 * client re-grants the circle keys automatically. Media therefore survives a
 * reset as long as at least one other member still holds the epoch keys; a
 * sole member's history becomes permanently undecryptable, which the client
 * must warn about before calling this.
 */
export const resetKeys = mutation({
  args: registrationArgs,
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const validated = validateRegistration(args);
    const now = Date.now();
    const existing = await ctx.db
      .query('userKeys')
      .withIndex('by_user', (q) => q.eq('userId', viewer._id))
      .unique();

    if (!existing) {
      await ctx.db.insert('userKeys', {
        userId: viewer._id,
        keyVersion: args.keyVersion,
        ...validated,
        createdAt: now,
        updatedAt: now,
      });

      return { created: true };
    }

    await ctx.db.patch(existing._id, {
      keyVersion: args.keyVersion,
      ...validated,
      updatedAt: now,
    });

    // Grants sealed to the replaced public key can never be opened again;
    // removing them marks the user as missing for honest re-grants.
    for (let pass = 0; pass < 20; pass += 1) {
      const staleGrants = await ctx.db
        .query('circleKeyGrants')
        .withIndex('by_user', (q) => q.eq('userId', viewer._id))
        .take(200);

      for (const grant of staleGrants) {
        await ctx.db.delete(grant._id);
      }

      if (staleGrants.length < 200) {
        break;
      }
    }

    return { created: false };
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
    rotationPending: v.boolean(),
    canRotate: v.boolean(),
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
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    const circle = await ctx.db.get(args.circleId);
    const currentEpoch = await getCurrentEpoch(ctx, args.circleId);
    const grants = await ctx.db
      .query('circleKeyGrants')
      .withIndex('by_circle_and_user_and_epoch', (q) =>
        q.eq('circleId', args.circleId).eq('userId', viewer._id),
      )
      .take(CIRCLE_KEY_EPOCH_LIMIT);

    return {
      currentEpoch: currentEpoch?.epoch ?? null,
      rotationPending: circle?.keyRotationPendingAt !== undefined,
      canRotate: canManageCircle(membership.role),
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
    // The fresh epoch excludes departed members again; lift the upload gate.
    await ctx.db.patch(args.circleId, { keyRotationPendingAt: undefined });

    return { epoch };
  },
});

/**
 * Lets a member discard their own grant they cannot open (sealed to stale or
 * wrong user keys, or poisoned by a malicious member). Grants are otherwise
 * first-writer-wins and listMissingKeyGrants treats an existing row as
 * delivered, so an unreadable grant would block that member forever; deleting
 * it makes them show up as missing again for an honest re-grant.
 */
export const rejectMyKeyGrant = mutation({
  args: {
    circleId: v.id('circles'),
    epoch: v.number(),
  },
  returns: v.object({ rejected: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const grant = await getGrant(ctx, args.circleId, viewer._id, args.epoch);

    if (!grant) {
      return { rejected: false };
    }

    await ctx.db.delete(grant._id);

    return { rejected: true };
  },
});

const missingMemberValidator = v.object({
  userId: v.id('users'),
  publicKey: v.union(v.string(), v.null()),
});

/**
 * Lists members lacking a grant for the current epoch and, when the caller
 * passes the epochs it holds, for those older epochs too. Old-epoch top-up is
 * what lets new joiners and users recovering from a key reset decrypt media
 * from before the latest rotation.
 */
export const listMissingKeyGrants = query({
  args: {
    circleId: v.id('circles'),
    /** Epochs the calling client holds and can seal; newest first. */
    epochs: v.optional(v.array(v.number())),
  },
  returns: v.object({
    currentEpoch: v.union(v.number(), v.null()),
    /** Members lacking a current-epoch grant (kept for older clients). */
    missing: v.array(missingMemberValidator),
    missingByEpoch: v.array(
      v.object({
        epoch: v.number(),
        members: v.array(missingMemberValidator),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);

    await requireCircleMembership(ctx, viewer._id, args.circleId);

    const currentEpoch = await getCurrentEpoch(ctx, args.circleId);

    if (!currentEpoch) {
      return { currentEpoch: null, missing: [], missingByEpoch: [] };
    }

    const requestedEpochs = new Set<number>([currentEpoch.epoch]);

    for (const epoch of args.epochs ?? []) {
      if (requestedEpochs.size >= MISSING_GRANTS_EPOCH_LIMIT) {
        break;
      }

      // Unknown or future epochs are ignored rather than rejected; the
      // caller's grant list can race a concurrent rotation.
      if (Number.isInteger(epoch) && epoch >= 1 && epoch <= currentEpoch.epoch) {
        requestedEpochs.add(epoch);
      }
    }

    const memberships = await ctx.db
      .query('circleMembers')
      .withIndex('by_circle', (q) => q.eq('circleId', args.circleId))
      .take(CIRCLE_MEMBER_LIST_LIMIT);
    const publicKeyByUser = new Map<Id<'users'>, string | null>();

    const memberFor = async (userId: Id<'users'>) => {
      if (!publicKeyByUser.has(userId)) {
        const keys = await ctx.db
          .query('userKeys')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .unique();

        publicKeyByUser.set(userId, keys?.publicKey ?? null);
      }

      return { userId, publicKey: publicKeyByUser.get(userId) ?? null };
    };

    const missingByEpoch = [];

    for (const epoch of [...requestedEpochs].sort((a, b) => b - a)) {
      const grants = await ctx.db
        .query('circleKeyGrants')
        .withIndex('by_circle_and_epoch', (q) =>
          q.eq('circleId', args.circleId).eq('epoch', epoch),
        )
        .take(CIRCLE_MEMBER_LIST_LIMIT);
      const grantedUserIds = new Set(grants.map((grant) => grant.userId));
      const members = [];

      for (const membership of memberships) {
        if (!grantedUserIds.has(membership.userId)) {
          members.push(await memberFor(membership.userId));
        }
      }

      if (members.length > 0) {
        missingByEpoch.push({ epoch, members });
      }
    }

    return {
      currentEpoch: currentEpoch.epoch,
      missing:
        missingByEpoch.find((entry) => entry.epoch === currentEpoch.epoch)?.members ?? [],
      missingByEpoch,
    };
  },
});
