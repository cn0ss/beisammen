import { v } from 'convex/values';

import type {
  BillingCheckoutResult,
  BillingPortalSessionResult,
  BillingStatus,
  CircleUploadReadiness,
} from '@beisammen/contracts';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalQuery } from './_generated/server';
import {
  createCloudCheckout,
  createCloudPortalSession,
  getCloudBillingStatus,
  isAutumnConfigured,
  BILLING_FEATURE_IDS,
} from './lib/billing/autumn';
import {
  CloudOwnerFeatureAccessError,
  type CircleBillingContext,
  getCloudOwnerBillingStatus,
  requireCloudOwnerFeatureAccess,
  resolveCircleBillingOwner,
} from './lib/billing/owner';
import { getDeploymentPolicyFromEnv, readCloudBillingPlansFromEnv } from './lib/instance';
import { requireCircleMembership, requireViewer } from './lib/viewer';

export const billingFunctionSurface = [
  'billing.status',
  'billing.statusForCircle',
  'billing.uploadReadinessForCircle',
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

export const uploadReadinessForCircle = action({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args): Promise<CircleUploadReadiness> => {
    const policy = getDeploymentPolicyFromEnv();
    const billingContext: CircleBillingContext = await ctx.runQuery(
      internal.billing.getCircleOwnerForBilling,
      {
        circleId: args.circleId,
      },
    );
    const viewerIsBillingOwner =
      billingContext.viewerId === billingContext.billingOwner._id;

    if (policy.isSelfHosted) {
      return {
        deployment: 'self-hosted',
        canUpload: true,
        viewerIsBillingOwner,
        billingRequired: false,
        reason: 'self_hosted',
        message: 'Self-hosted instances do not require Beisammen billing for uploads.',
      };
    }

    if (!isAutumnConfigured()) {
      return {
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner,
        billingRequired: true,
        reason: 'billing_not_configured',
        message: viewerIsBillingOwner
          ? 'Cloud billing is not configured for this instance yet.'
          : 'The circle billing owner needs active cloud billing before members can upload.',
      };
    }

    try {
      await requireCloudOwnerFeatureAccess(ctx, {
        owner: billingContext.billingOwner,
        entityId: billingContext.entityId,
        featureId: BILLING_FEATURE_IDS.mediaUploads,
        requiredBalance: 1,
        properties: {
          circleId: args.circleId,
          readiness: true,
        },
      });

      return {
        deployment: 'cloud',
        canUpload: true,
        viewerIsBillingOwner,
        billingRequired: true,
        reason: 'ready',
        message: 'Cloud billing is ready for media uploads.',
      };
    } catch (error) {
      const planRequired =
        error instanceof CloudOwnerFeatureAccessError && error.reason === 'not_allowed';

      return {
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner,
        billingRequired: true,
        reason: planRequired ? 'plan_required' : 'billing_check_failed',
        message: planRequired
          ? viewerIsBillingOwner
            ? 'Choose an active cloud plan before uploading media.'
            : 'The circle billing owner needs an active cloud plan before members can upload.'
          : 'Cloud billing could not be checked. Try again before uploading media.',
      };
    }
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
