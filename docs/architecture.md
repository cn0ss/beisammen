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

## Instance contract

- the app starts with `EXPO_PUBLIC_DEFAULT_INSTANCE_URL`
- the app resolves instance identity, backend URL, auth mode, and public auth config locally
- runtime backend discovery is currently disabled

## Public vs secret configuration

Expo treats client-side runtime values as public. In practice that means:

- `EXPO_PUBLIC_*` values are bundled into the JS app
- `app.config.ts` is public app metadata and must not contain secrets
- `apps/mobile/eas.json` is safe to commit only when it contains no secrets

Repository policy:

- commit only public client configuration and build profile names
- keep API keys, provider credentials, push credentials, and EAS tokens out of
  git
- keep Expo account ownership details out of git where practical
- EAS project IDs are public metadata and may be committed in
  `apps/mobile/app.config.ts` once the app is initialized for a real Expo
  project

## Data model

- `users`
- `circles`
- `circleMembers`
- `invites`
- `shareBatches`
- `assets`
- `uploads`
- `activityEvents`

## Future services

`services/` is reserved for a Go storage gateway once provider sync, NAS
mounting, instance discovery helpers, or media processing justifies a separate
service.
