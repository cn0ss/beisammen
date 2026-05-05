import { v } from 'convex/values';

import type {
  BillingCheckoutResult,
  BillingPortalSessionResult,
  BillingStatus,
} from '@beisammen/contracts';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalQuery } from './_generated/server';
import {
  createCloudCheckout,
  createCloudPortalSession,
  getCloudBillingStatus,
  isAutumnConfigured,
} from './lib/billing/autumn';
import {
  type CircleBillingContext,
  getCloudOwnerBillingStatus,
  resolveCircleBillingOwner,
} from './lib/billing/owner';
import { getDeploymentPolicyFromEnv, readCloudBillingPlansFromEnv } from './lib/instance';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const billingFunctionSurface = [
  'billing.status',
  'billing.statusForCircle',
  'billing.createCheckout',
  'billing.createPortalSession',
] as const;

export type BillingViewer = Pick<Doc<'users'>, '_id' | 'displayName' | 'email'>;

function selfHostedBillingStatus(): BillingStatus {
  return {
    deployment: 'self-hosted',
    billing: {
      enabled: false,
      configured: false,
    },
    plans: [],
    activePlanIds: [],
    subscriptions: [],
    balances: [],
  };
}

export const getViewerForBilling = internalQuery({
  args: {},
  handler: async (ctx): Promise<BillingViewer> => {
    const viewer = await requireViewer(ctx);

    return {
      _id: viewer._id,
      ...(viewer.displayName ? { displayName: viewer.displayName } : {}),
      ...(viewer.email ? { email: viewer.email } : {}),
    };
  },
});

export const getCircleOwnerForBilling = internalQuery({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args): Promise<CircleBillingContext> => {
    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);
    const billingOwner = await resolveCircleBillingOwner(ctx, args.circleId);

    return {
      circleId: args.circleId,
      entityId: args.circleId,
      viewerId: viewer._id as Id<'users'>,
      billingOwner,
    };
  },
});

export const status = action({
  args: {},
  handler: async (ctx): Promise<BillingStatus> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return selfHostedBillingStatus();
    }

    const viewer: BillingViewer = await ctx.runQuery(internal.billing.getViewerForBilling, {});

    return await getCloudBillingStatus(ctx, viewer);
  },
});

export const statusForCircle = action({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args): Promise<BillingStatus> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return selfHostedBillingStatus();
    }

    const billingContext: CircleBillingContext = await ctx.runQuery(
      internal.billing.getCircleOwnerForBilling,
      {
        circleId: args.circleId,
      },
    );

    if (billingContext.viewerId !== billingContext.billingOwner._id) {
      throw new Error('Only the circle billing owner can view this billing status.');
    }

    return await getCloudOwnerBillingStatus(ctx, billingContext.billingOwner);
  },
});

export const createCheckout = action({
  args: {
    planId: v.string(),
    successUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BillingCheckoutResult> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return {
        billingEnabled: false,
        checkoutUrl: null,
      };
    }

    if (!isAutumnConfigured()) {
      throw new Error('Autumn billing is not configured for this cloud deployment.');
    }

    const plans = readCloudBillingPlansFromEnv();

    if (!plans.some((plan) => plan.id === args.planId)) {
      throw new Error('Unknown billing plan.');
    }

    return await createCloudCheckout(ctx, {
      planId: args.planId,
      ...(args.successUrl ? { successUrl: args.successUrl } : {}),
    });
  },
});

export const createPortalSession = action({
  args: {
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BillingPortalSessionResult> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return {
        billingEnabled: false,
        portalUrl: null,
      };
    }

    if (!isAutumnConfigured()) {
      throw new Error('Autumn billing is not configured for this cloud deployment.');
    }

    return await createCloudPortalSession(ctx, {
      ...(args.returnUrl ? { returnUrl: args.returnUrl } : {}),
    });
  },
});
