# Private Beta QA Checklist

Run this checklist on a real iOS or Android development build against a WorkOS
tenant and an S3-compatible bucket (AWS S3, R2, B2 S3, or MinIO).

## Environment

- `EXPO_PUBLIC_DEFAULT_INSTANCE_URL` points at the Convex site URL.
- `EXPO_PUBLIC_DEFAULT_CONVEX_URL` points at the matching Convex client URL.
- `EXPO_PUBLIC_DEFAULT_AUTH_MODE` is `native-client` or `hosted-browser`.
- `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` are configured on the Convex deployment.
- `S3_BUCKET`, credentials, and optional `S3_REGION`, `S3_ENDPOINT`, and `S3_BASE_PATH` are configured.
- In Settings, run the storage check and confirm the configured S3-compatible bucket reports success.
- For an existing deployment, run `internal.circleStats.backfillBatch` and confirm it finishes.
- Run `internal.mediaCleanup.cleanupStale` once and confirm it returns a bounded
  result with no unexpected failures; the hourly cron uses the same action with
  scheduled continuation enabled for larger backlogs.
- Run `pnpm smoke:beta -- <instance-url> --app-version=<current-mobile-version>`
  before starting device QA, and confirm the command rejects deployments whose
  `client.minimumAppVersion` is newer than the app build under test.
- For a paired cloud/self-hosted release check, run
  `pnpm release:beta -- --cloud-url=<cloud-site-url> --self-hosted-url=<self-hosted-site-url> --app-version=<current-mobile-version>`.

## Cloud Golden Path

- Sign in with WorkOS, quit the app, reopen it, and confirm the session restores.
- Create a circle and confirm it becomes the active circle.
- Open Settings, confirm the billing card shows cloud billing, and verify the
  checkout and billing portal links open for the owner account.
- Invite a second account, open the invite link, sign in as that account, and accept it.
- Upload from the invited member into the owner's circle and confirm the owner
  plan is the one charged/limited.
- Upload one image and one video under 30 seconds; confirm the draft remains recoverable if one upload is retried.
- Publish the draft and confirm the feed shows previews, pagination works, and video cards do not try to render the original video as an image.
- Open share detail, play the video, save media to the device library, and use native sharing.
- Delete a draft asset, delete a published share, remove a member, and confirm counts update.

## Self-Hosted Golden Path

- Connect the central app with `beisammen://connect?instance=<self-host-url>`.
- Confirm the discovered manifest switches the active instance before sign-in.
- Raise `PUBLIC_MINIMUM_APP_VERSION` above the installed app version in a test
  deployment and confirm the connect link shows an update-required error instead
  of switching instances.
- Sign in with the self-hosted WorkOS tenant.
- Open Settings and confirm billing is disabled.
- Upload more than the cloud beta media count or a video over the cloud duration
  cap, and confirm self-hosted app-level limits do not block it.
- Verify S3-compatible upload, preview read, original read, and delete.

## Recovery Path

- Start an upload, interrupt the app or network before completion, then reopen
  the app and confirm cached items can retry while server-only incomplete rows
  can still be discarded.
- Create or simulate stale `uploading`/`failed` rows older than 24 hours, run
  `internal.mediaCleanup.cleanupStale`, and confirm only stale incomplete rows
  and their pending storage references are removed. For more than 50 stale rows,
  confirm scheduled continuation drains follow-up batches.
- Confirm completed uploads with assets remain visible after cleanup.

## Storage Targets

- AWS S3: upload, preview read, original read, delete.
- Cloudflare R2 or Backblaze B2 S3: upload, preview read, original read, delete.
- MinIO: upload, preview read, original read, delete.
