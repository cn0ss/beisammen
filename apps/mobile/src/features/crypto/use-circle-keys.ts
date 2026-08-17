import { useEffect, useRef, useState } from 'react';

import { useConvex, useQuery } from 'convex/react';

import { createLogger } from '@/lib/logger';

import { keysApi } from './api';
import { buildMissingGrantPayload, ensureCircleKey } from './circle-keys';
import { useCrypto } from './provider';
import { getSodium } from './sodium';

const logger = createLogger('crypto.circleKeys');

export type CircleKeysState =
  | { status: 'loading' }
  /** The circle has a key, but no member has sealed it to this user yet. */
  | { status: 'waiting-for-grant' }
  | {
      status: 'ready';
      epoch: number;
      circleKey: Uint8Array;
      keysByEpoch: Map<number, Uint8Array>;
    };

/**
 * Resolves the viewer's key for a circle (initializing the very first epoch
 * when needed) and opportunistically seals the current key to members that
 * lack a grant. Foundation for the media-encryption pipeline; see docs/e2ee.md.
 */
export function useCircleKeys(circleId: string | null | undefined): CircleKeysState {
  const convex = useConvex();
  const crypto = useCrypto();
  const [state, setState] = useState<CircleKeysState>({ status: 'loading' });
  // One grant top-up per (mount, circle): failures are expected races with
  // other members and must not retry in a loop.
  const grantAttemptedFor = useRef<string | null>(null);

  const userKeys = crypto.status === 'ready' ? crypto.userKeys : null;
  // Reactive subscription so a granted key or a rotation re-resolves without
  // polling; ensureCircleKey re-reads the authoritative state imperatively.
  const myCircleKeys = useQuery(
    keysApi.getMyCircleKeys,
    circleId && userKeys ? { circleId } : 'skip',
  );
  const subscriptionKey = myCircleKeys
    ? `${myCircleKeys.currentEpoch ?? 'none'}:${myCircleKeys.grants.length}`
    : null;

  useEffect(() => {
    if (!circleId || !userKeys || myCircleKeys === undefined) {
      setState({ status: 'loading' });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const sodium = await getSodium();
        const result = await ensureCircleKey({
          sodium,
          userKeys,
          getMyCircleKeys: () => convex.query(keysApi.getMyCircleKeys, { circleId }),
          initializeCircleKey: (sealedCircleKey) =>
            convex.mutation(keysApi.initializeCircleKey, { circleId, sealedCircleKey }),
        });

        if (cancelled) {
          return;
        }

        if (result.status === 'waiting-for-grant') {
          setState({ status: 'waiting-for-grant' });
          return;
        }

        setState({
          status: 'ready',
          epoch: result.epoch,
          circleKey: result.circleKey,
          keysByEpoch: result.keysByEpoch,
        });

        // Opportunistic top-up: seal the key to members without a grant.
        const attemptKey = circleId;

        if (grantAttemptedFor.current === attemptKey) {
          return;
        }

        grantAttemptedFor.current = attemptKey;

        try {
          const missing = await convex.query(keysApi.listMissingKeyGrants, { circleId });

          if (missing.currentEpoch !== result.epoch || missing.missing.length === 0) {
            return;
          }

          const grants = buildMissingGrantPayload(sodium, result.circleKey, missing.missing);

          if (grants.length > 0) {
            await convex.mutation(keysApi.grantCircleKeys, {
              circleId,
              epoch: result.epoch,
              grants,
            });
          }
        } catch {
          // Another member may have granted concurrently or membership changed
          // mid-flight; the next client holding the key will top up.
        }
      } catch (error) {
        if (!cancelled) {
          logger.warn('Failed to resolve circle key.', {
            circleId,
            message: error instanceof Error ? error.message : String(error),
          });
          setState({ status: 'loading' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, convex, subscriptionKey, userKeys]);

  return state;
}
