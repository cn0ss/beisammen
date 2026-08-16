# Architecture

## Stack

- `apps/mobile`: Expo Router + React Native
- `convex/`: Convex schema and backend surface
- `packages/*`: shared contracts, domain rules, UI primitives, config helpers

## System boundaries

- Convex stores app state and media metadata
- original media files stay in user-managed storage
- auth is standardized on WorkOS across official and self-hosted deployments
- mobile only receives public configuration through local app config
- official cloud deployments use the Autumn Convex component for plans,
  checkout, billing portal, and usage metering
- self-hosted deployments disable billing and app-enforced media limits

## Instance contract

- the app starts with `EXPO_PUBLIC_DEFAULT_INSTANCE_URL` and defaults to a
  `cloud` deployment unless `EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND` says
  `self-hosted`
- the app resolves the bundled default instance locally for first launch
- custom/self-hosted instances expose `/.well-known/beisammen-instance.json`
- the discovery manifest contains only public client config: instance identity,
  Convex client URL, auth mode, WorkOS public client ID or hosted sign-in URL,
  storage provider capabilities, deployment kind, billing provider/plan
  summaries, and minimum app version
- `beisammen://connect?instance=https://your-host` switches the active
  instance locally after validating the manifest
- invite links can include both `instance` and `invite`; invite tokens are
  stored under the selected instance URL

## Public vs secret configuration

Expo treats client-side runtime values as public. In practice that means:

- `EXPO_PUBLIC_*` values are bundled into the JS app
- `app.config.ts` is public app metadata and must not contain secrets
- `apps/mobile/eas.json` is local build metadata for this public snapshot

Repository policy:

- commit only public client configuration
- keep API keys, provider credentials, push credentials, and EAS tokens out of
  git
- keep Expo account ownership details and EAS project IDs out of the public
  snapshot

## Data model

- `users`
- `circles`
- `circleMembers`
- `invites`
- `publicCircleLinks`
- `shareBatches`
- `assets`
- `uploads`
- `memoryItems`
- `memoryMonths`
- `memoryPlaces`
- `activityEvents`
- `circleStats`

`circleStats` stores denormalized member and storage counters per circle. New
mutations maintain it directly. If a stats row is missing, mutation paths seed
one from the current bounded delta instead of recomputing the full circle
snapshot. Existing deployments should run `internal.circleStats.backfillBatch`
once after deploying the table so older circles have accurate stored counters
before operators rely on the values.

Interrupted uploads can leave `uploads` or `imageUploads` rows with pending S3
objects. `convex/crons.ts` runs `internal.mediaCleanup.cleanupStale` hourly with
scheduled continuation enabled, so routine cleanup drains stale rows in bounded
50-row batches. Operators can still run the same internal action manually after
crash recovery or during QA; it defaults to rows older than 24 hours, deletes
pending storage references first, and then removes stale `uploading` or `failed`
rows that have no completed asset.

`memoryItems` is the published-media timeline index used by the mobile Memories
tab. New uploads can store `assets.capturedAt` from device media metadata; older
published media should be backfilled with `internal.memories.backfillBatch`,
which uses `shareBatches.publishedAt` as the timeline fallback.
`memoryMonths` and `memoryPlaces` are lightweight discovery summaries for month
filters and the Places map. New published media maintains them directly. Existing
deployments with legacy memory rows should run
`internal.memories.backfillDiscoveryBatch` after `internal.memories.backfillBatch`;
use `dryRun=true` first to verify the bounded patch and summary counts.

`publicCircleLinks` stores revocable, hashed tokens for no-install web access to
a circle's published feed. The raw token is only returned when an owner or admin
creates a new link; public viewers load `/share/#<token>`, and the web frontend
exchanges that token through the Convex HTTP endpoint for a bounded, read-only
page of signed media URLs.

## Billing model

- `cloud`: `PUBLIC_DEPLOYMENT_KIND=cloud`; discovery advertises
  `billing.enabled=true` with provider `autumn`; the default public plan list is
  paid-only. Autumn customers are Beisammen users, and media usage for a circle
  is charged to that circle's `billingOwnerId` only. Invited members consume the
  owner's plan when they upload into that owner's circle; their own plan is not
  used for circles they do not own. Autumn `entity_id` is the circle id so usage
  can be attributed per circle while limits stay pooled across all circles owned
  by the paying user.
- `self-hosted`: `PUBLIC_DEPLOYMENT_KIND=self-hosted`; discovery advertises
  `billing.enabled=false`; upload count and video duration beta limits are not
  enforced, while file type validation still applies.
- Plan labels shown in the mobile app come from `PUBLIC_BILLING_PLANS`, falling
  back to the repository paid plan defaults. The billing product definition
  lives in the root `autumn.config.ts`; `docs/billing/autumn.config.ts`
  documents the CLI workflow.
- Convex setup requires `app.use(autumn)` in `convex/convex.config.ts`,
  `convex/autumn.ts` for user identification, and `AUTUMN_SECRET_KEY` set in the
  Convex environment.

## Future services

`services/` is reserved for a Go storage gateway once provider sync, NAS
mounting, instance discovery helpers, or media processing justifies a separate
service.
