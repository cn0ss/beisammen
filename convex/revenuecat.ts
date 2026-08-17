import { RevenueCat } from 'convex-revenuecat';

import { components } from './_generated/api';

const webhookAuth = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();

/**
 * Centralized RevenueCat component client. The webhook auth secret must match
 * the Authorization header configured on the RevenueCat webhook integration.
 * When unset (self-hosted deployments), the webhook endpoint rejects requests
 * and billing counts as not configured.
 */
export const revenuecat = new RevenueCat(components.revenuecat, {
  ...(webhookAuth ? { REVENUECAT_WEBHOOK_AUTH: webhookAuth } : {}),
});
