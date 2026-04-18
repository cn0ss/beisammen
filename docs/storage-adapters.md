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

- if `S3_BUCKET` is configured, uploads use `s3`
- otherwise the instance falls back to `convex-files`

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

## Future providers

- Google Drive
- Dropbox
- OneDrive
- filesystem/NAS through a Go gateway
