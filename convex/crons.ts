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

export default crons;
