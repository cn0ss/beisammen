# Storage Adapters

## V1

The first live provider is `s3-compatible`.

Supported targets in principle:

- AWS S3
- Cloudflare R2
- Backblaze B2 S3
- MinIO or other self-hosted S3-compatible object stores

## Contract

Shared storage references, upload targets, and signed read URL types live in
`packages/contracts`. Concrete S3 operations live in `convex/lib/storage/s3.ts`;
upload authorization and finalization live in `convex/uploads.ts`.

Storage is selected per deployment instance:

- `S3_BUCKET` is required for new uploads
- legacy `convex-files` references may still be read and deleted for data that
  existed before the S3-only upload path

The backend calls the S3 functions directly for presigned uploads and reads,
object verification, deletion, and connection validation.

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

Cloud deployments enforce RevenueCat plan access and Convex storage quotas before
storage-generating uploads. Neither deployment kind limits media counts or video
duration. Both enforce storage safety checks and MIME validation.

## Future providers

- Google Drive
- Dropbox
- OneDrive
- filesystem/NAS through a Go gateway
