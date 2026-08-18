import {
  generateCircleKey,
  openCircleKeyGrant,
  publicKeyFromBase64,
  sealCircleKeyForMember,
  type SodiumApi,
} from '@beisammen/crypto';

import type { MissingKeyGrants, MyCircleKeys } from './api';
import type { UnlockedUserKeys } from './user-keys';

export type CircleKeyResult =
  /** The circle key for the current epoch, plus older epochs for legacy assets. */
  | { status: 'ready'; epoch: number; circleKey: Uint8Array; keysByEpoch: Map<number, Uint8Array> }
  /** The circle has a key, but no member has sealed it to this user yet. */
  | { status: 'waiting-for-grant'; currentEpoch: number };

interface CircleKeyDeps {
  sodium: SodiumApi;
  userKeys: UnlockedUserKeys;
  getMyCircleKeys: () => Promise<MyCircleKeys>;
  initializeCircleKey: (sealedCircleKey: string) => Promise<{ epoch: number; created: boolean }>;
  /**
   * Deletes the viewer's stored grant for an epoch they cannot open. Grants
   * are first-writer-wins and an existing row counts as delivered, so without
   * rejection an unreadable (stale or poisoned) grant blocks this member from
   * ever receiving a working one.
   */
  rejectKeyGrant?: (epoch: number) => Promise<unknown>;
}

function openGrants(
  sodium: SodiumApi,
  userKeys: UnlockedUserKeys,
  grants: MyCircleKeys['grants'],
): { keysByEpoch: Map<number, Uint8Array>; unreadableEpochs: Set<number> } {
  const keysByEpoch = new Map<number, Uint8Array>();
  const unreadableEpochs = new Set<number>();

  for (const grant of grants) {
    try {
      keysByEpoch.set(
        grant.epoch,
        openCircleKeyGrant(sodium, {
          sealedCircleKey: grant.sealedCircleKey,
          publicKey: userKeys.publicKey,
          privateKey: userKeys.privateKey,
        }),
      );
      unreadableEpochs.delete(grant.epoch);
    } catch {
      // An unreadable grant (e.g. sealed to rotated user keys or poisoned by
      // another member) is recorded so the caller can reject it server-side.
      if (!keysByEpoch.has(grant.epoch)) {
        unreadableEpochs.add(grant.epoch);
      }
    }
  }

  return { keysByEpoch, unreadableEpochs };
}

/**
 * Resolves the viewer's circle key, initializing epoch 1 with a self-grant
 * when the circle has no key yet (first member to come online wins; losers
 * of that race re-read and use the stored grant).
 */
export async function ensureCircleKey(deps: CircleKeyDeps): Promise<CircleKeyResult> {
  const { sodium, userKeys } = deps;
  let state = await deps.getMyCircleKeys();

  if (state.currentEpoch === null) {
    const circleKey = generateCircleKey(sodium);
    const initialized = await deps.initializeCircleKey(
      sealCircleKeyForMember(sodium, {
        circleKey,
        memberPublicKey: userKeys.publicKey,
      }),
    );

    if (initialized.created) {
      return {
        status: 'ready',
        epoch: initialized.epoch,
        circleKey,
        keysByEpoch: new Map([[initialized.epoch, circleKey]]),
      };
    }

    state = await deps.getMyCircleKeys();
  }

  const currentEpoch = state.currentEpoch;

  if (currentEpoch === null) {
    throw new Error('Circle key initialization did not produce an epoch.');
  }

  const { keysByEpoch, unreadableEpochs } = openGrants(sodium, userKeys, state.grants);
  const circleKey = keysByEpoch.get(currentEpoch);

  if (!circleKey) {
    if (unreadableEpochs.has(currentEpoch) && deps.rejectKeyGrant) {
      // Delete the unreadable grant so this member reappears in
      // listMissingKeyGrants and an honest key holder can re-grant.
      await deps.rejectKeyGrant(currentEpoch).catch(() => undefined);
    }

    return { status: 'waiting-for-grant', currentEpoch };
  }

  return { status: 'ready', epoch: currentEpoch, circleKey, keysByEpoch };
}

/**
 * Seals every held epoch key to the members missing a grant for that epoch.
 * Covering old epochs too is what gives new joiners and key-reset users
 * access to media from before the latest rotation. One entry per epoch; the
 * server enforces membership and idempotency per grantCircleKeys call.
 */
export function buildMissingGrantPayloadsByEpoch(
  sodium: SodiumApi,
  keysByEpoch: Map<number, Uint8Array>,
  missingByEpoch: MissingKeyGrants['missingByEpoch'],
): Array<{ epoch: number; grants: Array<{ userId: string; sealedCircleKey: string }> }> {
  const payloads = [];

  for (const entry of missingByEpoch) {
    const circleKey = keysByEpoch.get(entry.epoch);

    if (!circleKey) {
      continue;
    }

    const grants = buildMissingGrantPayload(sodium, circleKey, entry.members);

    if (grants.length > 0) {
      payloads.push({ epoch: entry.epoch, grants });
    }
  }

  return payloads;
}

/**
 * Seals the current epoch key to every member who lacks a grant (new joiners,
 * members whose grants were skipped). Call whenever a member client holding
 * the key is online; the server enforces membership and idempotency.
 */
export function buildMissingGrantPayload(
  sodium: SodiumApi,
  circleKey: Uint8Array,
  missing: MissingKeyGrants['missing'],
): Array<{ userId: string; sealedCircleKey: string }> {
  const payload: Array<{ userId: string; sealedCircleKey: string }> = [];

  for (const member of missing) {
    if (!member.publicKey) {
      // The member has not registered user keys yet; retry once they have.
      continue;
    }

    try {
      payload.push({
        userId: member.userId,
        sealedCircleKey: sealCircleKeyForMember(sodium, {
          circleKey,
          memberPublicKey: publicKeyFromBase64(member.publicKey),
        }),
      });
    } catch {
      // One member's malformed public key must not abort the whole batch;
      // everyone else still gets their grant.
    }
  }

  return payload;
}

/**
 * Builds the grant set for a key rotation (e.g. right after removing a
 * member): a fresh circle key sealed to every remaining member, including
 * the rotating member themselves.
 */
export function buildRotationPayload(
  sodium: SodiumApi,
  members: Array<{ userId: string; publicKey: string | null }>,
): {
  circleKey: Uint8Array;
  grants: Array<{ userId: string; sealedCircleKey: string }>;
  skippedUserIds: string[];
} {
  const circleKey = generateCircleKey(sodium);
  const grants: Array<{ userId: string; sealedCircleKey: string }> = [];
  const skippedUserIds: string[] = [];

  for (const member of members) {
    if (!member.publicKey) {
      skippedUserIds.push(member.userId);
      continue;
    }

    try {
      grants.push({
        userId: member.userId,
        sealedCircleKey: sealCircleKeyForMember(sodium, {
          circleKey,
          memberPublicKey: publicKeyFromBase64(member.publicKey),
        }),
      });
    } catch {
      // A malformed public key must not block the rotation for everyone else.
      skippedUserIds.push(member.userId);
    }
  }

  return { circleKey, grants, skippedUserIds };
}
