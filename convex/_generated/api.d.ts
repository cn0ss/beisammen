/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assets from "../assets.js";
import type * as autumn from "../autumn.js";
import type * as billing from "../billing.js";
import type * as circleStats from "../circleStats.js";
import type * as circles from "../circles.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing_autumn from "../lib/billing/autumn.js";
import type * as lib_billing_owner from "../lib/billing/owner.js";
import type * as lib_httpHelpers from "../lib/httpHelpers.js";
import type * as lib_instance from "../lib/instance.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_shareAssets from "../lib/shareAssets.js";
import type * as lib_storage_adapter from "../lib/storage/adapter.js";
import type * as lib_storage_s3 from "../lib/storage/s3.js";
import type * as lib_storage_shared from "../lib/storage/shared.js";
import type * as lib_uploadLimits from "../lib/uploadLimits.js";
import type * as lib_viewer from "../lib/viewer.js";
import type * as lib_workos from "../lib/workos.js";
import type * as mediaCleanup from "../mediaCleanup.js";
import type * as rateLimit from "../rateLimit.js";
import type * as shares from "../shares.js";
import type * as storageStats from "../storageStats.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assets: typeof assets;
  autumn: typeof autumn;
  billing: typeof billing;
  circleStats: typeof circleStats;
  circles: typeof circles;
  crons: typeof crons;
  http: typeof http;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/billing/autumn": typeof lib_billing_autumn;
  "lib/billing/owner": typeof lib_billing_owner;
  "lib/httpHelpers": typeof lib_httpHelpers;
  "lib/instance": typeof lib_instance;
  "lib/permissions": typeof lib_permissions;
  "lib/shareAssets": typeof lib_shareAssets;
  "lib/storage/adapter": typeof lib_storage_adapter;
  "lib/storage/s3": typeof lib_storage_s3;
  "lib/storage/shared": typeof lib_storage_shared;
  "lib/uploadLimits": typeof lib_uploadLimits;
  "lib/viewer": typeof lib_viewer;
  "lib/workos": typeof lib_workos;
  mediaCleanup: typeof mediaCleanup;
  rateLimit: typeof rateLimit;
  shares: typeof shares;
  storageStats: typeof storageStats;
  uploads: typeof uploads;
  users: typeof users;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  autumn: import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
};
