import { v } from 'convex/values';

import type {
  BillingStatus,
  CircleCreationReadiness,
  CircleUploadReadiness,
  PurchaseSyncResult,
} from '@beisammen/contracts';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalQuery, query } from './_generated/server';
import { countOwnedCircles } from './billingUsage';
import { CLOUD_PLAN_QUOTAS } from './lib/billing/plans';
import {
  BILLING_FEATURE_IDS,
  CloudOwnerFeatureAccessError,
  type CircleBillingContext,
  getCloudBillingStatus,
  getCloudOwnerBillingStatus,
  isBillingConfigured,
  requireCloudOwnerFeatureAccess,
  resolveCircleBillingOwner,
  resolveOwnerPlanTier,
  syncOwnerFromRevenueCat,
} from './lib/billing/quota';
import { getDeploymentPolicyFromEnv } from './lib/instance';
import { findViewer, getViewerMembership, requireCircleMembership, requireViewer } from './lib/viewer';

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

export const getViewerForPurchaseSync = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<'users'>> => {
    const viewer = await requireViewer(ctx);

    return viewer._id;
  },
});

/**
 * Reconciles the viewer's RevenueCat subscriber state into Convex on demand.
 * The mobile app calls this right after a purchase or restore (and when the
 * store reports an active entitlement the backend does not know about yet) so
 * plan-gated features unlock without depending on webhook latency.
 */
export const syncPurchases = action({
  args: {},
  handler: async (ctx): Promise<PurchaseSyncResult> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return { status: 'self_hosted', activePlanId: null };
    }

    if (!isBillingConfigured()) {
      return { status: 'billing_not_configured', activePlanId: null };
    }

    const viewerId: Id<'users'> = await ctx.runQuery(
      internal.billing.getViewerForPurchaseSync,
      {},
    );
    const status = await syncOwnerFromRevenueCat(ctx, viewerId);

    if (status !== 'synced') {
      return { status, activePlanId: null };
    }

    return {
      status,
      activePlanId: await resolveOwnerPlanTier(ctx, viewerId),
    };
  },
});

export const status = query({
  args: {},
  handler: async (ctx): Promise<BillingStatus> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return selfHostedBillingStatus();
    }

    const viewer = await requireViewer(ctx);

    return await getCloudBillingStatus(ctx, {
      _id: viewer._id,
      ...(viewer.displayName ? { displayName: viewer.displayName } : {}),
      ...(viewer.email ? { email: viewer.email } : {}),
    });
  },
});

export const statusForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args): Promise<BillingStatus> => {
    const policy = getDeploymentPolicyFromEnv();

    if (policy.isSelfHosted) {
      return selfHostedBillingStatus();
    }

    const viewer = await requireViewer(ctx);
    await requireCircleMembership(ctx, viewer._id, args.circleId);
    const billingOwner = await resolveCircleBillingOwner(ctx, args.circleId);

    if (viewer._id !== billingOwner._id) {
      throw new Error('Only the circle billing owner can view this billing status.');
    }

    return await getCloudOwnerBillingStatus(ctx, billingOwner);
  },
});

export const circleCreationReadiness = query({
  args: {},
  handler: async (ctx): Promise<CircleCreationReadiness | null> => {
    const policy = getDeploymentPolicyFromEnv();
    // Tolerate auth transitions while the client is subscribed.
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    const viewer = await findViewer(ctx);

    if (!viewer) {
      return null;
    }

    if (policy.isSelfHosted) {
      return {
        deployment: 'self-hosted',
        canCreate: true,
        billingRequired: false,
        reason: 'self_hosted',
        message: 'Self-hosted instances do not limit circle creation.',
        usedCircles: null,
        maxCircles: null,
      };
    }

    if (!isBillingConfigured()) {
      // Without billing there is nothing to meter; uploads are gated separately.
      return {
        deployment: 'cloud',
        canCreate: true,
        billingRequired: false,
        reason: 'billing_not_configured',
        message: 'Cloud billing is not configured; circle creation is not metered.',
        usedCircles: null,
        maxCircles: null,
      };
    }

    const usedCircles = await countOwnedCircles(ctx, viewer._id);

    try {
      const tier = await resolveOwnerPlanTier(ctx, viewer._id);

      if (!tier) {
        return {
          deployment: 'cloud',
          canCreate: false,
          billingRequired: true,
          reason: 'plan_required',
          message: 'An active cloud plan is required to create a circle.',
          usedCircles,
          maxCircles: null,
        };
      }

      const maxCircles = CLOUD_PLAN_QUOTAS[tier].maxCircles;

      if (usedCircles >= maxCircles) {
        return {
          deployment: 'cloud',
          canCreate: false,
          billingRequired: true,
          reason: 'limit_reached',
          message: 'The cloud plan circle limit is reached.',
          usedCircles,
          maxCircles,
        };
      }

      return {
        deployment: 'cloud',
        canCreate: true,
        billingRequired: true,
        reason: 'ready',
        message: 'The cloud plan has a free circle slot.',
        usedCircles,
        maxCircles,
      };
    } catch {
      return {
        deployment: 'cloud',
        canCreate: false,
        billingRequired: true,
        reason: 'billing_check_failed',
        message: 'Cloud billing could not be checked. Try again shortly.',
        usedCircles,
        maxCircles: null,
      };
    }
  },
});

export const uploadReadinessForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args): Promise<CircleUploadReadiness | null> => {
    const policy = getDeploymentPolicyFromEnv();
    // Subscribed with a client-held circle id: tolerate auth transitions and
    // circle deletion mid-subscription by returning null.
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    const viewer = await findViewer(ctx);

    if (!viewer) {
      return null;
    }

    const membership = await getViewerMembership(ctx, viewer._id, args.circleId);
    const circle = await ctx.db.get(args.circleId);

    if (!membership || !circle) {
      return null;
    }

    const billingOwner = await resolveCircleBillingOwner(ctx, args.circleId);
    const viewerIsBillingOwner = viewer._id === billingOwner._id;

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

    if (!isBillingConfigured()) {
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
        owner: billingOwner,
        entityId: args.circleId,
        featureId: BILLING_FEATURE_IDS.storageBytes,
        requiredBalance: 1,
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
      const accessError =
        error instanceof CloudOwnerFeatureAccessError ? error : null;
      const reason: CircleUploadReadiness['reason'] =
        accessError?.reason === 'not_allowed'
          ? 'plan_required'
          : accessError?.reason === 'quota_exceeded'
            ? 'quota_exceeded'
            : 'billing_check_failed';
      const message =
        reason === 'plan_required'
          ? viewerIsBillingOwner
            ? 'Choose an active cloud plan before uploading media.'
            : 'The circle billing owner needs an active cloud plan before members can upload.'
          : reason === 'quota_exceeded'
            ? viewerIsBillingOwner
              ? 'Your cloud plan storage is full. Free up space or upgrade your plan.'
              : 'The circle billing owner has no cloud storage left.'
            : 'Cloud billing could not be checked. Try again before uploading media.';

      return {
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner,
        billingRequired: true,
        reason,
        message,
      };
    }
  },
});
