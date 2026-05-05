import type {
  BillingBalanceSummary,
  BillingCheckoutResult,
  BillingPortalSessionResult,
  BillingStatus,
  BillingSubscriptionSummary,
} from '@beisammen/contracts';

import type { Doc } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { autumn } from '../../autumn';
import { readCloudBillingPlansFromEnv } from '../instance';

export const billingBackendKind = 'convex-component' as const;

export const BILLING_FEATURE_IDS = {
  mediaUploads: 'media_uploads',
  storageBytes: 'storage_bytes',
} as const;

export type AutumnCustomerInput = Pick<Doc<'users'>, '_id' | 'displayName' | 'email'>;

interface AutumnResult<T = unknown> {
  data?: T | null;
  error?: {
    message?: string;
    code?: string;
  } | null;
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

function readOptionalEnv(name: string): string | null {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

export function isAutumnConfigured(): boolean {
  return Boolean(readOptionalEnv('AUTUMN_SECRET_KEY'));
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
  viewer: AutumnCustomerInput;
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
      customerId: input.viewer._id,
    },
    plans: readCloudBillingPlansFromEnv(),
    activePlanIds: normalizeActivePlanIds(subscriptions),
    subscriptions,
    balances: normalizeBalances(customer.balances ?? customer.features),
  };
}

export async function getCloudBillingStatus(
  ctx: ActionCtx,
  viewer: AutumnCustomerInput,
): Promise<Extract<BillingStatus, { deployment: 'cloud' }>> {
  if (!isAutumnConfigured()) {
    return cloudBillingStatusFromCustomer({
      viewer,
      configured: false,
      customer: null,
    });
  }

  const result = await autumn.customers.get(ctx, { expand: [] }) as AutumnResult;

  return cloudBillingStatusFromCustomer({
    viewer,
    configured: true,
    customer: result.error ? null : result.data,
  });
}

export async function requireCloudFeatureAccess(
  ctx: ActionCtx,
  input: {
    featureId: string;
    requiredBalance?: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  const result = await autumn.check(ctx, {
    featureId: input.featureId,
    requiredBalance: input.requiredBalance ?? 1,
    ...(input.properties ? { properties: input.properties } : {}),
  }) as AutumnResult;
  const data = isRecord(result.data) ? result.data : {};

  if (result.error || data.allowed !== true) {
    throw new Error(
      autumnErrorMessage(result, 'This cloud plan does not allow the requested usage.'),
    );
  }
}

export async function trackCloudUsage(
  ctx: ActionCtx,
  input: {
    featureId: string;
    value: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.value === 0) {
    return;
  }

  const result = await autumn.track(ctx, {
    featureId: input.featureId,
    value: input.value,
    ...(input.properties ? { properties: input.properties } : {}),
  }) as AutumnResult;

  if (result.error) {
    throw new Error(autumnErrorMessage(result, 'Autumn usage tracking failed.'));
  }
}

export async function createCloudCheckout(
  ctx: ActionCtx,
  input: {
    planId: string;
    successUrl?: string;
  },
): Promise<BillingCheckoutResult> {
  const result = await autumn.checkout(ctx, {
    productId: input.planId,
    ...(input.successUrl ? { successUrl: input.successUrl } : {}),
  }) as AutumnResult;
  const data = isRecord(result.data) ? result.data : {};

  if (result.error) {
    throw new Error(autumnErrorMessage(result, 'Autumn checkout failed.'));
  }

  return {
    billingEnabled: true,
    checkoutUrl: stringOrNull(data.url ?? data.checkout_url ?? data.checkoutUrl),
  };
}

export async function createCloudPortalSession(
  ctx: ActionCtx,
  input: {
    returnUrl?: string;
  },
): Promise<BillingPortalSessionResult> {
  const result = await autumn.customers.billingPortal(ctx, {
    ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
  }) as AutumnResult;
  const data = isRecord(result.data) ? result.data : {};

  if (result.error) {
    throw new Error(autumnErrorMessage(result, 'Autumn billing portal failed.'));
  }

  return {
    billingEnabled: true,
    portalUrl: stringOrNull(data.url ?? data.portal_url ?? data.portalUrl),
  };
}
