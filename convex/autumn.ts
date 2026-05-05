import { Autumn } from '@useautumn/convex';

import { components, internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import type { BillingViewer } from './billing';

export const autumnFunctionSurface = [
  'autumn.track',
  'autumn.check',
  'autumn.checkout',
  'autumn.billingPortal',
  'autumn.query',
] as const;

export const autumn = new Autumn(components.autumn, {
  secretKey: process.env.AUTUMN_SECRET_KEY ?? '',
  ...(process.env.AUTUMN_API_URL ? { url: process.env.AUTUMN_API_URL } : {}),
  identify: async (ctx: ActionCtx) => {
    const viewer: BillingViewer = await ctx.runQuery(internal.billing.getViewerForBilling, {});

    return {
      customerId: viewer._id,
      customerData: {
        ...(viewer.displayName ? { name: viewer.displayName } : {}),
        ...(viewer.email ? { email: viewer.email } : {}),
      },
    };
  },
});
