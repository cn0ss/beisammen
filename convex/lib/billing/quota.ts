import type {
  BillingBalanceSummary,
  BillingStatus,
  BillingSubscriptionSummary,
} from '@beisammen/contracts';

import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { revenuecat } from '../../revenuecat';
import { readCloudBillingPlansFromEnv } from '../instance';
import {
  CLOUD_PLAN_QUOTAS,
  ENTITLEMENT_PRIORITY,
  isCloudPlanTier,
  type CloudPlanTier,
} from './plans';

/** Billing state is mirrored into Convex by the RevenueCat component. */
export const billingBackendKind = 'convex-component' as const;

export const BILLING_FEATURE_IDS = {
  mediaUploads: 'media_uploads',
  storageBytes: 'storage_bytes',
  circles: 'circles',
} as const;

type DbCtx = QueryCtx | MutationCtx;
type RunQueryCtx = Pick<ActionCtx, 'runQuery'>;
type RunMutationCtx = Pick<ActionCtx, 'runQuery' | 'runMutation'>;

export interface BillingOwner {
  _id: Id<'users'>;
  displayName?: string;
  email?: string;
}

export interface CircleBillingContext {
  circleId: Id<'circles'>;
  entityId: string;
  viewerId: Id<'users'>;
  billingOwner: BillingOwner;
}

interface OwnerUsage {
  periodKey: string;
  uploadCount: number;
  storageBytes: number;
  circleCount: number;
}

export class CloudOwnerFeatureAccessError extends Error {
  constructor(
    readonly reason: 'not_allowed' | 'quota_exceeded' | 'provider_error',
    message: string,
  ) {
    super(message);
    this.name = 'CloudOwnerFeatureAccessError';
  }
}

export function ownerCustomerId(ownerId: Id<'users'>): string {
  return ownerId;
}

export function isBillingConfigured(): boolean {
  const value = process.env.REVENUECAT_WEBHOOK_AUTH;

  return Boolean(value && value.trim().length > 0);
}

function billingOwnerFromUser(user: Doc<'users'>): BillingOwner {
  return {
    _id: user._id,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {}),
  };
}

async function findRoleOwner(
  ctx: DbCtx,
  circleId: Id<'circles'>,
): Promise<Id<'users'> | null> {
  const ownerMembership = await ctx.db
    .query('circleMembers')
    .withIndex('by_circle_and_role', (q) =>
      q.eq('circleId', circleId).eq('role', 'owner'),
    )
    .first();

  return ownerMembership?.userId ?? null;
}

export async function resolveCircleBillingOwner(
  ctx: DbCtx,
  circleId: Id<'circles'>,
): Promise<BillingOwner> {
  const circle = await ctx.db.get(circleId);

  if (!circle) {
    throw new Error('Circle not found.');
  }

  const ownerIds = [
    circle.billingOwnerId ?? null,
    await findRoleOwner(ctx, circleId),
    circle.createdBy,
  ].filter((ownerId): ownerId is Id<'users'> => ownerId !== null);

  for (const ownerId of ownerIds) {
    const owner = await ctx.db.get(ownerId);

    if (owner) {
      return billingOwnerFromUser(owner);
    }
  }

  throw new Error('Circle billing owner not found.');
}

/**
 * Resolves the plan tier from the owner's active RevenueCat entitlements.
 * Entitlement ids equal the plan/tier ids; the highest active tier wins.
 */
export async function resolveOwnerPlanTier(
  ctx: RunQueryCtx,
  ownerId: Id<'users'>,
): Promise<CloudPlanTier | null> {
  for (const tier of ENTITLEMENT_PRIORITY) {
    const hasTier = await revenuecat.hasEntitlement(ctx, {
      appUserId: ownerCustomerId(ownerId),
      entitlementId: tier,
    });

    if (hasTier) {
      return tier;
    }
  }

  return null;
}

async function getOwnerUsage(ctx: RunQueryCtx, ownerId: Id<'users'>): Promise<OwnerUsage> {
  return await ctx.runQuery(internal.billingUsage.getUsageForOwner, { ownerId });
}

function usageDeltasForFeature(
  featureId: string,
  value: number,
): { mediaUploadsDelta: number; storageBytesDelta: number } {
  if (featureId === BILLING_FEATURE_IDS.mediaUploads) {
    return { mediaUploadsDelta: value, storageBytesDelta: 0 };
  }

  if (featureId === BILLING_FEATURE_IDS.storageBytes) {
    return { mediaUploadsDelta: 0, storageBytesDelta: value };
  }

  throw new Error(`Unknown billing feature "${featureId}".`);
}

async function requireOwnerFeatureAccess(
  ctx: RunQueryCtx,
  input: {
    ownerId: Id<'users'>;
    featureId: string;
    requiredBalance: number;
  },
): Promise<void> {
  if (!isBillingConfigured()) {
    throw new CloudOwnerFeatureAccessError(
      'provider_error',
      'Cloud billing is not configured for this deployment.',
    );
  }

  let tier: CloudPlanTier | null;
  let usage: OwnerUsage;

  try {
    tier = await resolveOwnerPlanTier(ctx, input.ownerId);
    usage = await getOwnerUsage(ctx, input.ownerId);
  } catch (error) {
    throw new CloudOwnerFeatureAccessError(
      'provider_error',
      error instanceof Error ? error.message : 'Cloud billing could not be checked.',
    );
  }

  if (!tier) {
    throw new CloudOwnerFeatureAccessError(
      'not_allowed',
      'An active cloud plan is required for this usage.',
    );
  }

  const quota = CLOUD_PLAN_QUOTAS[tier];
  const withinQuota =
    input.featureId === BILLING_FEATURE_IDS.storageBytes
      ? usage.storageBytes + input.requiredBalance <= quota.storageBytes
      : input.featureId === BILLING_FEATURE_IDS.circles
        ? usage.circleCount + input.requiredBalance <= quota.maxCircles
        : null;

  if (withinQuota === null) {
    throw new CloudOwnerFeatureAccessError(
      'provider_error',
      `Unknown billing feature "${input.featureId}".`,
    );
  }

  if (!withinQuota) {
    throw new CloudOwnerFeatureAccessError(
      'quota_exceeded',
      'The cloud plan quota for this feature is exhausted.',
    );
  }
}

async function trackOwnerUsage(
  ctx: RunMutationCtx,
  input: {
    ownerId: Id<'users'>;
    featureId: string;
    value: number;
  },
): Promise<void> {
  if (input.value === 0) {
    return;
  }

  await ctx.runMutation(
    internal.billingUsage.adjustUsage,
    {
      ownerId: input.ownerId,
      ...usageDeltasForFeature(input.featureId, input.value),
    },
  );
}

export async function requireCloudOwnerFeatureAccess(
  ctx: RunQueryCtx,
  input: {
    owner: BillingOwner;
    entityId: string;
    featureId: string;
    requiredBalance?: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  await requireOwnerFeatureAccess(ctx, {
    ownerId: input.owner._id,
    featureId: input.featureId,
    requiredBalance: input.requiredBalance ?? 1,
  });
}

export async function trackCloudOwnerUsage(
  ctx: RunMutationCtx,
  input: {
    owner: BillingOwner;
    entityId: string;
    featureId: string;
    value: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  await trackOwnerUsage(ctx, {
    ownerId: input.owner._id,
    featureId: input.featureId,
    value: input.value,
  });
}

function summarizeSubscription(
  subscription: Awaited<ReturnType<typeof revenuecat.getActiveSubscriptions>>[number],
): BillingSubscriptionSummary {
  const entitledTier = subscription.entitlementIds?.find(isCloudPlanTier) ?? null;

  return {
    planId: entitledTier ?? subscription.productId,
    status: 'active',
    currentPeriodEnd: subscription.expirationAtMs ?? null,
  };
}

function buildBalances(tier: CloudPlanTier | null, usage: OwnerUsage): BillingBalanceSummary[] {
  if (!tier) {
    return [];
  }

  const quota = CLOUD_PLAN_QUOTAS[tier];

  return [
    {
      featureId: BILLING_FEATURE_IDS.storageBytes,
      granted: quota.storageBytes,
      remaining: Math.max(0, quota.storageBytes - usage.storageBytes),
      usage: usage.storageBytes,
      unlimited: false,
      overageAllowed: false,
      nextResetAt: null,
    },
    {
      featureId: BILLING_FEATURE_IDS.circles,
      granted: quota.maxCircles,
      remaining: Math.max(0, quota.maxCircles - usage.circleCount),
      usage: usage.circleCount,
      unlimited: false,
      overageAllowed: false,
      nextResetAt: null,
    },
  ];
}

async function buildCloudBillingStatus(
  ctx: RunQueryCtx,
  owner: BillingOwner,
): Promise<Extract<BillingStatus, { deployment: 'cloud' }>> {
  const configured = isBillingConfigured();

  if (!configured) {
    return {
      deployment: 'cloud',
      billing: {
        enabled: true,
        configured: false,
        provider: 'revenuecat',
        customerId: ownerCustomerId(owner._id),
      },
      plans: readCloudBillingPlansFromEnv(),
      activePlanIds: [],
      subscriptions: [],
      balances: [],
      managementUrl: null,
    };
  }

  const appUserId = ownerCustomerId(owner._id);
  const [tier, usage, subscriptions, customer] = await Promise.all([
    resolveOwnerPlanTier(ctx, owner._id),
    getOwnerUsage(ctx, owner._id),
    revenuecat.getActiveSubscriptions(ctx, { appUserId }),
    revenuecat.getCustomer(ctx, { appUserId }),
  ]);

  return {
    deployment: 'cloud',
    billing: {
      enabled: true,
      configured: true,
      provider: 'revenuecat',
      customerId: appUserId,
    },
    plans: readCloudBillingPlansFromEnv(),
    activePlanIds: tier ? [tier] : [],
    subscriptions: subscriptions.map(summarizeSubscription),
    balances: buildBalances(tier, usage),
    managementUrl: customer?.managementUrl ?? null,
  };
}

export async function getCloudOwnerBillingStatus(
  ctx: RunQueryCtx,
  owner: BillingOwner,
): Promise<Extract<BillingStatus, { deployment: 'cloud' }>> {
  return await buildCloudBillingStatus(ctx, owner);
}

/** Viewer-scoped billing status; the viewer is their own billing owner. */
export async function getCloudBillingStatus(
  ctx: RunQueryCtx,
  viewer: BillingOwner,
): Promise<Extract<BillingStatus, { deployment: 'cloud' }>> {
  return await buildCloudBillingStatus(ctx, viewer);
}
