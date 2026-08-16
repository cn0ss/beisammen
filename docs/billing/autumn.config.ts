// The Autumn CLI source of truth for Beisammen cloud billing lives at:
//
//   ../../autumn.config.ts
//
// Push it from the repository root:
//
//   pnpm dlx atmn preview -c autumn.config.ts --currency USD
//   pnpm dlx atmn push -c autumn.config.ts
//
// After the sandbox config is verified, production can be pushed explicitly:
//
//   pnpm dlx atmn push -p -c autumn.config.ts
//
// Beisammen cloud billing is owner-sponsored:
// - the Autumn customer id is the paying Beisammen user id
// - the Autumn entity id is the circle id
// - plan limits are pooled across circles owned by that user
// - member uploads into an owned circle consume the owner's plan
//
// Required feature ids used by Convex:
// - media_uploads
// - storage_bytes
//
// Required paid plan ids:
// - cloud_family
// - cloud_archive

export { cloudArchive, cloudFamily, mediaUploads, storageBytes } from '../../autumn.config';
