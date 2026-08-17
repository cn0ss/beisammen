import { v } from 'convex/values';

import { compareAppVersions } from '@beisammen/contracts';

import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, query } from './_generated/server';

/**
 * Client compatibility gate. One singleton row (key 'default'); an absent row
 * (fresh or self-hosted instances) means no restrictions. Managed via CLI:
 *
 *   npx convex run appConfig:set '{"minSupportedAppVersion":"1.1"}'
 *   npx convex run appConfig:set '{"maintenanceMode":true,"maintenanceMessage":"..."}'
 *   npx convex run appConfig:set '{}'   # lift all restrictions
 *
 * `set` replaces the whole config, so omitted fields are cleared.
 */

const APP_CONFIG_KEY = 'default';

async function getConfigRow(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query('appConfig')
    .withIndex('by_key', (q) => q.eq('key', APP_CONFIG_KEY))
    .unique();
}

export const get = query({
  args: {},
  returns: v.union(
    v.object({
      minSupportedAppVersion: v.union(v.string(), v.null()),
      forceUpdateMessage: v.union(v.string(), v.null()),
      maintenanceMode: v.boolean(),
      maintenanceMessage: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const config = await getConfigRow(ctx);

    if (!config) {
      return null;
    }

    return {
      minSupportedAppVersion: config.minSupportedAppVersion ?? null,
      forceUpdateMessage: config.forceUpdateMessage ?? null,
      maintenanceMode: config.maintenanceMode ?? false,
      maintenanceMessage: config.maintenanceMessage ?? null,
    };
  },
});

export const set = internalMutation({
  args: {
    minSupportedAppVersion: v.optional(v.string()),
    forceUpdateMessage: v.optional(v.string()),
    maintenanceMode: v.optional(v.boolean()),
    maintenanceMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.minSupportedAppVersion !== undefined) {
      // Throws on an unparseable version so a typo cannot end up in the
      // config. Clients additionally fail open if comparison ever throws.
      compareAppVersions(args.minSupportedAppVersion, args.minSupportedAppVersion);
    }

    const doc = {
      key: APP_CONFIG_KEY,
      ...args,
      updatedAt: Date.now(),
    };
    const existing = await getConfigRow(ctx);

    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert('appConfig', doc);
    }

    return null;
  },
});

/**
 * App-version distribution across registered notification devices — the data
 * basis for deciding when old clients are rare enough to contract schema or
 * remove deprecated functions. Run via:
 *
 *   npx convex run appConfig:appVersionAdoption
 */
export const appVersionAdoption = internalQuery({
  args: {},
  returns: v.object({
    scanned: v.number(),
    truncated: v.boolean(),
    versions: v.record(v.string(), v.number()),
  }),
  handler: async (ctx) => {
    // Bounded scan; enough for private-beta scale. Revisit with pagination if
    // the device table ever outgrows this.
    const limit = 4096;
    const devices = await ctx.db.query('notificationDevices').take(limit);
    const versions: Record<string, number> = {};

    for (const device of devices) {
      if (device.disabledAt !== undefined) {
        continue;
      }

      const key = device.appVersion ?? 'unknown';
      versions[key] = (versions[key] ?? 0) + 1;
    }

    return {
      scanned: devices.length,
      truncated: devices.length === limit,
      versions,
    };
  },
});
