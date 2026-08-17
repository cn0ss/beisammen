import type { ConvexReactClient } from 'convex/react';

import { createLogger } from '@/lib/logger';

import { keysApi } from './api';
import { buildRotationPayload, ensureCircleKey } from './circle-keys';
import { getSodium } from './sodium';
import type { UnlockedUserKeys } from './user-keys';

const logger = createLogger('crypto.rotation');

/**
 * Best-effort circle key rotation after a member was removed: generates a
 * fresh epoch key sealed to every remaining member (self included). Only
 * possible when this client holds the current circle key; failures never
 * block the removal UX.
 *
 * TODO(e2ee): removed members keep the old epoch keys until this rotation
 * lands. When this client cannot rotate (no key, offline, error), the next
 * manage-role member client holding the key should rotate instead; see the
 * member-removal notes in docs/e2ee.md.
 */
export async function rotateCircleKeyAfterMemberRemoval(options: {
  convex: ConvexReactClient;
  circleId: string;
  userKeys: UnlockedUserKeys;
}): Promise<void> {
  const { convex, circleId, userKeys } = options;

  try {
    const sodium = await getSodium();
    const myKeys = await convex.query(keysApi.getMyCircleKeys, { circleId });

    if (myKeys.currentEpoch === null) {
      // No circle key yet, so the removed member never held one either.
      return;
    }

    const resolved = await ensureCircleKey({
      sodium,
      userKeys,
      getMyCircleKeys: () => Promise.resolve(myKeys),
      initializeCircleKey: () => {
        // Unreachable: currentEpoch is non-null, so ensureCircleKey never
        // initializes here.
        throw new Error('Unexpected circle key initialization during rotation.');
      },
    });

    if (resolved.status !== 'ready') {
      logger.info('Skipping post-removal rotation: viewer does not hold the circle key.', {
        circleId,
      });
      return;
    }

    const members = await convex.query(keysApi.getCircleMemberPublicKeys, { circleId });
    const rotation = buildRotationPayload(sodium, members);

    await convex.mutation(keysApi.rotateCircleKey, { circleId, grants: rotation.grants });

    if (rotation.skippedUserIds.length > 0) {
      logger.info('Rotated circle key; members without registered keys were skipped.', {
        circleId,
        skippedCount: rotation.skippedUserIds.length,
      });
    }
  } catch (error) {
    logger.warn('Post-removal circle key rotation failed; continuing without it.', {
      circleId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
