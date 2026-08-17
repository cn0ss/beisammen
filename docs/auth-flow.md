# Auth Flow

## Current direction

- auth provider is hard-wired to `clerk` for official and self-hosted deployments
- Convex validates Clerk JWTs in `convex/auth.config.ts` via the Clerk JWT
  template named `convex` (`CLERK_JWT_ISSUER_DOMAIN` points at the Clerk issuer)
- circles and family membership remain application data, not auth-provider data

## Mobile flow

1. The Expo app resolves the active instance from local app configuration.
2. The instance configuration carries the Clerk publishable key in
   `auth.publicConfig.publishableKey`.
3. `ClerkProvider` (from `@clerk/expo`) owns sign-in, token storage
   (`expo-secure-store` token cache), and token refresh.
4. The sign-in screen drives a custom flow with Clerk hooks: email + password
   (`useSignIn().signIn.password`), sign-up with email-code verification
   (`useSignUp()`), and Google/Apple SSO (`useSSO().startSSOFlow`).
5. `ConvexProviderWithClerk` (from `convex/react-clerk`) fetches Convex JWTs
   from the `convex` template and keeps the Convex client authenticated.
6. The client stores only the active instance config and pending invite tokens;
   session tokens live in Clerk's secure token cache.

## Secret boundary

- only public instance config values may reach the client (the publishable key
  is public by design)
- `CLERK_SECRET_KEY` is never used by the app or Convex backend; the backend
  only verifies JWTs against the issuer's JWKS
- the client reads `EXPO_PUBLIC_DEFAULT_INSTANCE_URL` and
  `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, not provider secrets

## Current implementation status

The mobile app includes:

- an instance loader with built-in official fallbacks
- invite-link based instance switching via `beisammen://connect?instance=...`
  (switching signs the Clerk session out and remounts `ClerkProvider` with the
  target instance's publishable key)
- secure per-instance pending-invite persistence
- viewer bootstrap that upserts the Convex user record from the Clerk identity
  after the first authenticated call

Deployment requirements:

- `CLERK_JWT_ISSUER_DOMAIN` must be set on the Convex deployment and match the
  Clerk instance's issuer (a JWT template named `convex` must exist)
- `PUBLIC_AUTH_PUBLISHABLE_KEY` must be set so instance discovery serves the
  Clerk publishable key to clients
- the app build needs `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for the default
  instance
- the Clerk application must have the Native API enabled with the app's iOS
  bundle id and Android package (`app.beisammen.app`) registered
