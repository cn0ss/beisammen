# Auth Flow

## Current direction

- auth provider is hard-wired to `workos` for official and self-hosted deployments
- Convex validates WorkOS JWTs in `convex/auth.config.ts`
- circles and family membership remain application data, not auth-provider data

## Mobile flow

1. The Expo app resolves the active instance from local app configuration.
2. The instance configuration declares which WorkOS auth mode the app should use.
3. The mobile app uses the WorkOS adapter.
4. Hosted-browser providers redirect back via the app scheme.
5. Native-client providers can sign in without a hosted roundtrip.
6. The client stores only minimal session state tied to the active instance.

## Secret boundary

- only public instance config values may reach the client
- provider API keys, signing secrets, and cookie infrastructure remain server-only
- the client reads `EXPO_PUBLIC_DEFAULT_INSTANCE_URL`, not provider secrets

## Current scaffold status

The mobile app now includes:

- an instance loader with built-in official fallbacks
- invite-link based instance switching via `beisammen://connect?instance=...`
- a shared auth adapter interface with a single WorkOS implementation

Real provider exchanges and secure persisted sessions still need concrete
backend wiring per deployment.
