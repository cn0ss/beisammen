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
}

function openGrants(
  sodium: SodiumApi,
  userKeys: UnlockedUserKeys,
  grants: MyCircleKeys['grants'],
): Map<number, Uint8Array> {
  const keysByEpoch = new Map<number, Uint8Array>();

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
    } catch {
      // An unreadable grant (e.g. sealed to rotated user keys) is skipped;
      // the member shows up in listMissingKeyGrants and gets a fresh one.
    }
  }

  return keysByEpoch;
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

  const keysByEpoch = openGrants(sodium, userKeys, state.grants);
  const circleKey = keysByEpoch.get(currentEpoch);

  if (!circleKey) {
    return { status: 'waiting-for-grant', currentEpoch };
  }

  return { status: 'ready', epoch: currentEpoch, circleKey, keysByEpoch };
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

    payload.push({
      userId: member.userId,
      sealedCircleKey: sealCircleKeyForMember(sodium, {
        circleKey,
        memberPublicKey: publicKeyFromBase64(member.publicKey),
      }),
    });
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

    grants.push({
      userId: member.userId,
      sealedCircleKey: sealCircleKeyForMember(sodium, {
        circleKey,
        memberPublicKey: publicKeyFromBase64(member.publicKey),
      }),
    });
  }

  return { circleKey, grants, skippedUserIds };
}
