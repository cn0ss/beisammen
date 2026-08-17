/**
 * Cloud plan tiers map 1:1 to RevenueCat entitlement identifiers and to the
 * plan ids advertised through instance discovery (`PUBLIC_BILLING_PLANS`).
 */
export type CloudPlanTier = 'cloud_plus' | 'cloud_max';

/** Highest tier first — when multiple entitlements are active the best wins. */
export const ENTITLEMENT_PRIORITY: CloudPlanTier[] = ['cloud_max', 'cloud_plus'];

export interface CloudPlanQuota {
  storageBytes: number;
  maxCircles: number;
}

/**
 * Hard caps enforced by Convex. RevenueCat only syncs entitlements; usage is
 * counted in the `billingUsage`/`billingStorage` tables. No overages.
 *
 * Only storage and circle count are capped — storage is what actually costs
 * money (R2 bills by bytes). Upload counts are still tracked per month in
 * `billingUsage` for observability, but never enforced.
 *
 * One plan covers every circle the subscriber owns: `maxCircles` caps how many
 * circles they can create, and all of them draw from the same storage pool.
 * Existing circles survive a downgrade; only creating new ones is blocked
 * while over the limit.
 */
export const CLOUD_PLAN_QUOTAS: Record<CloudPlanTier, CloudPlanQuota> = {
  // Marketed as "Plus". Storage stays within the annual-price guardrail:
  // €49.99/yr nets ~€2.93/mo, so the cap must stay well under ~200 GB of R2.
  cloud_plus: {
    storageBytes: 100 * 1024 ** 3,
    maxCircles: 3,
  },
  // Marketed as "Max".
  cloud_max: {
    storageBytes: 250 * 1024 ** 3,
    maxCircles: 10,
  },
};

export function isCloudPlanTier(value: unknown): value is CloudPlanTier {
  return value === 'cloud_plus' || value === 'cloud_max';
}

/** Upload counters reset per UTC calendar month; counter rows are keyed by this. */
export function currentPeriodKey(now: number = Date.now()): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${date.getUTCFullYear()}-${month}`;
}
