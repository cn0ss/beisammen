import { Autumn } from 'autumn-js';
import type {
  BillingBalanceSummary,
  BillingStatus,
  BillingSubscriptionSummary,
} from '@beisammen/contracts';

import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { readCloudBillingPlansFromEnv } from '../instance';
import { isAutumnConfigured } from './autumn';

type DbCtx = QueryCtx | MutationCtx;

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

export class CloudOwnerFeatureAccessError extends Error {
  constructor(
    readonly reason: 'not_allowed' | 'provider_error',
    message: string,
  ) {
    super(message);
    this.name = 'CloudOwnerFeatureAccessError';
  }
}

interface AutumnResult<T = unknown> {
  data?: T | null;
  error?: {
    message?: string;
    code?: string;
    statusCode?: number;
  } | null;
  statusCode?: number;
}

interface AutumnBalanceRecord {
  balance?: unknown;
  feature_id?: unknown;
  featureId?: unknown;
  granted?: unknown;
  included_usage?: unknown;
  includedUsage?: unknown;
  remaining?: unknown;
  usage?: unknown;
  unlimited?: unknown;
  overage_allowed?: unknown;
  overageAllowed?: unknown;
  next_reset_at?: unknown;
  nextResetAt?: unknown;
}

interface AutumnSubscriptionRecord {
  id?: unknown;
  plan_id?: unknown;
  planId?: unknown;
  status?: unknown;
  current_period_end?: unknown;
  currentPeriodEnd?: unknown;
}

export function ownerCustomerId(ownerId: Id<'users'>): string {
  return ownerId;
}

function ownerCustomerData(owner: BillingOwner): { name?: string; email?: string } {
  return {
    ...(owner.displayName ? { name: owner.displayName } : {}),
    ...(owner.email ? { email: owner.email } : {}),
  };
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

function getAutumnForOwner() {
  return new Autumn({
    secretKey: process.env.AUTUMN_SECRET_KEY ?? '',
    ...(process.env.AUTUMN_API_URL ? { url: process.env.AUTUMN_API_URL } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function booleanOrFalse(value: unknown): boolean {
  return value === true;
}

function autumnErrorMessage(result: AutumnResult, fallback: string): string {
  return result.error?.message ?? fallback;
}

function isAutumnNotFound(result: AutumnResult): boolean {
  const code = result.error?.code?.toLowerCase();

  return (
    result.statusCode === 404 ||
    result.error?.statusCode === 404 ||
    code === 'not_found' ||
    code === 'customer_not_found' ||
    code === 'customer_not_found_error'
  );
}

function autumnCustomerOrNull(result: AutumnResult, fallback: string): unknown | null {
  if (!result.error) {
    return result.data ?? null;
  }

  if (isAutumnNotFound(result)) {
    return null;
  }

  throw new Error(autumnErrorMessage(result, fallback));
}

function normalizeBalance(
  featureId: string,
  value: AutumnBalanceRecord,
): BillingBalanceSummary {
  return {
    featureId,
    granted: numberOrNull(value.granted ?? value.included_usage ?? value.includedUsage),
    remaining: numberOrNull(value.remaining ?? value.balance),
    usage: numberOrNull(value.usage),
    unlimited: booleanOrFalse(value.unlimited),
    overageAllowed: booleanOrFalse(value.overage_allowed ?? value.overageAllowed),
    nextResetAt: numberOrNull(value.next_reset_at ?? value.nextResetAt),
  };
}

function normalizeBalances(value: unknown): BillingBalanceSummary[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .map(([key, balance]) => {
      if (!isRecord(balance)) {
        return null;
      }

      return normalizeBalance(
        stringOrNull(balance.feature_id ?? balance.featureId) ?? key,
        balance,
      );
    })
    .filter((balance): balance is BillingBalanceSummary => balance !== null);
}

function normalizeSubscriptions(value: unknown): BillingSubscriptionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((subscription): BillingSubscriptionSummary | null => {
      if (!isRecord(subscription)) {
        return null;
      }

      const record = subscription as AutumnSubscriptionRecord;
      const planId = stringOrNull(record.plan_id ?? record.planId ?? record.id);

      if (!planId) {
        return null;
      }

      return {
        planId,
        status: stringOrNull(record.status) ?? 'unknown',
        currentPeriodEnd: numberOrNull(
          record.current_period_end ?? record.currentPeriodEnd,
        ),
      };
    })
    .filter((subscription): subscription is BillingSubscriptionSummary => subscription !== null);
}

function normalizeActivePlanIds(subscriptions: BillingSubscriptionSummary[]): string[] {
  return subscriptions
    .filter((subscription) =>
      ['active', 'trialing', 'past_due'].includes(subscription.status),
    )
    .map((subscription) => subscription.planId);
}

function cloudBillingStatusFromCustomer(input: {
  owner: BillingOwner;
  configured: boolean;
  customer: unknown;
}): Extract<BillingStatus, { deployment: 'cloud' }> {
  const customer = isRecord(input.customer) ? input.customer : {};
  const subscriptions = normalizeSubscriptions(customer.subscriptions ?? customer.products);

  return {
    deployment: 'cloud',
    billing: {
      enabled: true,
      configured: input.configured,
      provider: 'autumn',
      customerId: ownerCustomerId(input.owner._id),
    },
    plans: readCloudBillingPlansFromEnv(),
    activePlanIds: normalizeActivePlanIds(subscriptions),
    subscriptions,
    balances: normalizeBalances(customer.balances ?? customer.features),
  };
}

export async function getCloudOwnerBillingStatus(
  _ctx: ActionCtx,
  owner: BillingOwner,
): Promise<Extract<BillingStatus, { deployment: 'cloud' }>> {
  if (!isAutumnConfigured()) {
    return cloudBillingStatusFromCustomer({
      owner,
      configured: false,
      customer: null,
    });
  }

  const result = (await getAutumnForOwner().customers.get(
    ownerCustomerId(owner._id),
  )) as AutumnResult;
  const customer = autumnCustomerOrNull(result, 'Autumn billing status failed.');

  return cloudBillingStatusFromCustomer({
    owner,
    configured: true,
    customer,
  });
}

export async function requireCloudOwnerFeatureAccess(
  _ctx: ActionCtx,
  input: {
    owner: BillingOwner;
    entityId: string;
    featureId: string;
    requiredBalance?: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  const result = (await getAutumnForOwner().check({
    customer_id: ownerCustomerId(input.owner._id),
    customer_data: ownerCustomerData(input.owner),
    entity_id: input.entityId,
    feature_id: input.featureId,
    entity_data: {
      feature_id: input.featureId,
    },
    required_balance: input.requiredBalance ?? 1,
    ...(input.properties ? { properties: input.properties } : {}),
  })) as AutumnResult;
  const data = isRecord(result.data) ? result.data : {};

  if (data.allowed === false) {
    throw new CloudOwnerFeatureAccessError(
      'not_allowed',
      autumnErrorMessage(result, 'This cloud plan does not allow the requested usage.'),
    );
  }

  if (result.error || data.allowed !== true) {
    throw new CloudOwnerFeatureAccessError(
      'provider_error',
      autumnErrorMessage(result, 'Cloud billing could not be checked.'),
    );
  }
}

export async function trackCloudOwnerUsage(
  _ctx: ActionCtx,
  input: {
    owner: BillingOwner;
    entityId: string;
    featureId: string;
    value: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.value === 0) {
    return;
  }

  const result = (await getAutumnForOwner().track({
    customer_id: ownerCustomerId(input.owner._id),
    customer_data: ownerCustomerData(input.owner),
    entity_id: input.entityId,
    feature_id: input.featureId,
    entity_data: {
      feature_id: input.featureId,
    },
    value: input.value,
    ...(input.properties ? { properties: input.properties } : {}),
  })) as AutumnResult;

  if (result.error) {
    throw new Error(autumnErrorMessage(result, 'Autumn usage tracking failed.'));
  }
}
