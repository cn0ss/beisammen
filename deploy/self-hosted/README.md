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
- Local mobile support for custom self-hosted instances is not wired up yet.
- This scaffold does not yet provision your WorkOS tenant, client, or redirect setup for you.
