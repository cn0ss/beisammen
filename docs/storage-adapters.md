# Storage Adapters

## V1

The first live provider is `s3-compatible`.

Supported targets in principle:

- AWS S3
- Cloudflare R2
- Backblaze B2 S3
- MinIO or other self-hosted S3-compatible object stores

## Contract

The shared storage contract lives in `packages/contracts`.

Storage is selected per deployment instance:

- `S3_BUCKET` is required for new uploads
- legacy `convex-files` references may still be read and deleted for data that
  existed before the S3-only upload path

Each provider adapter is expected to implement:

- upload target creation
- upload completion
- signed reads
- deletes
- connection validation

## Why S3 first

- best object-storage semantics for large media
- direct uploads and signed URLs are straightforward
- official cloud deployments can be pinned to an instance-wide bucket
- self-hosted S3-compatible storage already covers an important private-hosting use case

## Current beta behavior

New media uploads store the picked original without client-side compression.
When the client can prepare one, it also creates a separate JPEG preview object.
Feed cards and thumbnails request preview URLs; share detail playback, download,
and native sharing request original URLs.

Cloud deployments keep the current app-level beta media count and video duration
limits while Autumn enforces paid plan access and usage billing before
storage-generating uploads. Self-hosted deployments keep the same storage safety
checks and MIME validation, but do not enforce those app product limits.

## Future providers

- Google Drive
- Dropbox
- OneDrive
- filesystem/NAS through a Go gateway
