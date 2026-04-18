# Beisammen

Beisammen is a **source-available** photo and video sharing app for private circles such as partners, families, and close friends. The repository is public, but the project is **not OSI open source**.

## License model

- Source available under **PolyForm Noncommercial 1.0.0**
- Private use and private/self-hosted deployments are allowed
- Commercial hosting, resale, managed hosting, and white-label resale are not allowed without a separate commercial license
- The Beisammen name, logo, and branding are not granted automatically

Read [docs/licensing.md](docs/licensing.md) and [NOTICE](NOTICE) before using or redistributing the project.

## Product scope

- Expo React Native app in `apps/mobile`
- Convex-first backend in `convex/`
- WorkOS authentication for official and self-hosted deployments
- BYO storage architecture with S3-compatible storage first
- Central app distribution with official and self-hosted instances
- Web-ready package boundaries without a web app yet

## Repo structure

```text
apps/mobile            Expo app with Expo Router
packages/contracts     Shared API and storage contracts
packages/domain        Domain types and helper rules
packages/ui-mobile     Shared React Native UI primitives
packages/upload-client Upload queue model and state helpers
packages/config        Public-vs-secret environment helpers
convex/                Convex schema and backend scaffolding
docs/                  Architecture, auth, licensing, self-hosting docs
services/              Reserved for future Go services
```

## Local development

1. Copy `.env.example` to `.env.local` and fill in your own values.
2. Install dependencies with `pnpm install`.
3. Start Metro for the development build with `pnpm dev:mobile`.
4. Install or refresh the native dev build with `pnpm ios:mobile` or `pnpm android:mobile`.
5. Start Convex separately with `pnpm convex:dev`.

## Public repository boundaries

- This public repository intentionally excludes local assistant tooling, EAS build configuration, and all real deployment credentials.
- Only placeholder values belong in `.env.example`.
- `apps/mobile/app.config.ts` is public app metadata and must stay free of secrets and account-specific linkage.
- If you need local Expo build configuration, create your own untracked `apps/mobile/eas.json`.

## Instance model

- the mobile app boots from `EXPO_PUBLIC_DEFAULT_INSTANCE_URL`
- official instance configuration is currently bundled into the app
- auth mode is selected from local app configuration, not via backend discovery
- every deployment uses WorkOS as the auth provider
- self-hosted deployments can point the same app binary at their own instance URL

## Secret handling rules

- Only `EXPO_PUBLIC_*` variables may be referenced from React Native code.
- `app.config.ts` is treated as public app metadata. Do not put secrets there.
- auth provider secrets, storage credentials, APNs/FCM keys, real EAS tokens, and local assistant metadata must stay out of git.
- `apps/mobile/eas.json` is intentionally not tracked in the public repository.
- Expo account/project linkage should stay out of `apps/mobile/app.config.ts` in the public snapshot.

See [docs/architecture.md](docs/architecture.md) for the environment boundary.
