import { defineApp } from 'convex/server';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';
import resend from '@convex-dev/resend/convex.config.js';
import revenuecat from 'convex-revenuecat/convex.config';

const app = defineApp();

app.use(rateLimiter);
app.use(resend);
app.use(revenuecat);

export default app;
