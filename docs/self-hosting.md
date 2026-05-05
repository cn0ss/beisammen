# Self-Hosting

Private and noncommercial self-hosting is allowed under the repository license.

## Intended use

- couples
- families
- friend groups
- hobby and personal archival use

## Expectations

- every self-hosted deployment uses WorkOS for authentication
- you provide your own WorkOS tenant, client, and redirect/domain configuration
- you bring your own S3-compatible storage credentials; new uploads require S3
- you operate your own deployment and backups
- billing is disabled; no Autumn, payment plans, upload-count limit, or video
  duration limit is required for self-hosted instances
- support is best-effort only

## Supported self-hosted auth mode

### `self-hosted-workos`

- required for all current self-hosted installs
- supports the same hosted-browser and native-client flows as the official app
- requires your own WorkOS tenant and redirect/domain configuration

## App connection model

- users can connect the central Beisammen mobile app to a self-hosted instance
- invite links can point the app to a self-hosted instance with
  `beisammen://connect?instance=https://your-host`
- the instance must serve a public discovery manifest at
  `https://your-host/.well-known/beisammen-instance.json`
- the manifest tells the app which Convex client URL, auth mode, public WorkOS
  client ID or hosted sign-in URL, deployment kind, billing mode, and storage
  capabilities to use
- links with both `instance` and `invite` switch the active instance before
  storing the invite token locally

## Required deployment mode

Set these values on the backend and mobile build that should point at your
self-hosted default:

```bash
PUBLIC_DEPLOYMENT_KIND=self-hosted
EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND=self-hosted
```

`PUBLIC_SELF_HOSTED=true` is still accepted for older deployments, but new
configuration should use `PUBLIC_DEPLOYMENT_KIND`.

## Not allowed without a commercial license

- paid hosting for third parties
- managed Beisammen instances as a service
- resale or white-label redistribution for money

## Branding

If you redistribute modified builds, replace Beisammen-specific branding unless
you have explicit permission to keep it.
