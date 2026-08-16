import { describe, expect, test } from 'vitest';

import { getBillingReturnRefreshDecision } from './return-refresh';

describe('billing return refresh decisions', () => {
  test('refreshes again when the same checkout return appears after params were cleared', () => {
    const firstReturn = getBillingReturnRefreshDecision({
      params: {
        billing: 'return',
        source: 'checkout',
      },
      handledReturnKey: null,
    });

    expect(firstReturn).toEqual({
      shouldRefresh: true,
      nextHandledReturnKey: 'return:checkout',
    });

    const cleared = getBillingReturnRefreshDecision({
      params: {},
      handledReturnKey: firstReturn.nextHandledReturnKey,
    });

    expect(cleared).toEqual({
      shouldRefresh: false,
      nextHandledReturnKey: null,
    });

    expect(
      getBillingReturnRefreshDecision({
        params: {
          billing: 'return',
          source: 'checkout',
        },
        handledReturnKey: cleared.nextHandledReturnKey,
      }),
    ).toEqual({
      shouldRefresh: true,
      nextHandledReturnKey: 'return:checkout',
    });
  });
});
