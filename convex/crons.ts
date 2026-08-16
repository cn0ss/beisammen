import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale interrupted media uploads',
  { hours: 1 },
  internal.mediaCleanup.cleanupStale,
  {
    continueOnMore: true,
  },
);

crons.interval(
  'dispatch queued push notifications',
  { minutes: 1 },
  internal.notifications.dispatchQueued,
  {},
);

crons.interval(
  'check Expo push receipts',
  { minutes: 15 },
  internal.notifications.checkReceipts,
  {},
);

export default crons;
