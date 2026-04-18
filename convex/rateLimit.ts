import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter';

import { components } from './_generated/api';

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  waitlistJoinByIp: {
    kind: 'fixed window',
    rate: 5,
    period: MINUTE,
    capacity: 10,
  },
  waitlistJoinGlobal: {
    kind: 'fixed window',
    rate: 200,
    period: MINUTE,
  },
});
