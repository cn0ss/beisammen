# Self-hosted Compose Scaffold

This directory provides a local scaffold for running:

- the official Convex self-hosted backend
- the official Convex dashboard

The scaffold exposes the Convex backend on:

- `http://127.0.0.1:3210`
- site proxy on `http://127.0.0.1:3211`
- dashboard on `http://127.0.0.1:6791`

## Start locally

```bash
docker compose up
```

## Notes

- Convex image names follow the official public container packages:
  - `ghcr.io/get-convex/convex-backend:latest`
  - `ghcr.io/get-convex/convex-dashboard:latest`
- Mobile custom-instance support expects your deployed Beisammen Convex
  functions to serve `/.well-known/beisammen-instance.json` from the site URL.
- Configure the manifest with `PUBLIC_INSTANCE_ID`, `PUBLIC_INSTANCE_NAME`,
  `PUBLIC_CONVEX_URL`, `PUBLIC_AUTH_MODE`, `PUBLIC_AUTH_CLIENT_ID`,
  `PUBLIC_AUTH_SIGN_IN_URL`, `PUBLIC_DEPLOYMENT_KIND=self-hosted`, and
  `PUBLIC_MINIMUM_APP_VERSION`.
- This scaffold does not yet provision your WorkOS tenant, client, or redirect setup for you.
