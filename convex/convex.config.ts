import { defineApp } from 'convex/server';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';
import autumn from '@useautumn/convex/convex.config';

const app = defineApp();

app.use(rateLimiter);
app.use(autumn);

export default app;
