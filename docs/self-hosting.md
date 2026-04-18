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
- you bring your own storage credentials
- you operate your own deployment and backups
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
- the mobile app still needs local support for that host; runtime backend discovery is currently disabled

## Not allowed without a commercial license

- paid hosting for third parties
- managed Beisammen instances as a service
- resale or white-label redistribution for money

## Branding

If you redistribute modified builds, replace Beisammen-specific branding unless
you have explicit permission to keep it.
