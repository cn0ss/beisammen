import type {
  CreateUploadTargetInput,
  StorageProviderKind,
  InstanceStorageStatus,
  SignedReadUrl,
  S3StorageReference,
  StorageReference,
} from '@beisammen/contracts';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { deleteS3Object } from './s3';

type StorageCtx = QueryCtx | MutationCtx;

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function requireEnv(name: string): string {
  const value = readOptionalEnv(name);

  if (!value) {
    throw new Error(`${name} must be set.`);
  }

  return value;
}

export function buildS3ObjectKey(
  input: CreateUploadTargetInput & { uploadId: Id<'uploads'> },
): string {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');

  return [
    input.circleId,
    year,
    month,
    input.shareBatchId,
    input.uploadId,
    safeFileName,
  ].join('/');
}

export function buildImageUploadObjectKey(input: {
  targetKind: 'user-profile' | 'circle-image';
  userId: Id<'users'>;
  circleId?: Id<'circles'>;
  fileName: string;
  uploadId: Id<'imageUploads'>;
}): string {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');

  if (input.targetKind === 'user-profile') {
    return ['users', input.userId, 'profile', year, month, input.uploadId, safeFileName].join('/');
  }

  if (!input.circleId) {
    throw new Error('circleId is required for circle image uploads.');
  }

  return ['circles', input.circleId, 'image', year, month, input.uploadId, safeFileName].join('/');
}

export function getS3AccessKeyId(): string {
  return requireEnv('S3_ACCESS_KEY_ID');
}

export function getS3SecretAccessKey(): string {
  return requireEnv('S3_SECRET_ACCESS_KEY');
}

export function getCurrentInstanceStorage(): InstanceStorageStatus {
  const bucket = readOptionalEnv('S3_BUCKET');

  if (!bucket) {
    throw new Error(
      'S3_BUCKET must be set. S3-compatible storage is required.',
    );
  }

  return {
    providerKind: 's3',
    label: 'S3 Bucket',
    bucket,
    region: readOptionalEnv('S3_REGION'),
    endpoint: readOptionalEnv('S3_ENDPOINT'),
    basePath: readOptionalEnv('S3_BASE_PATH'),
  };
}

export function requireS3StorageProvider(providerKind: StorageProviderKind): 's3' {
  if (providerKind !== 's3') {
    throw new Error('S3-compatible storage is required for image uploads.');
  }

  return providerKind;
}

export function buildS3StorageReference(input: {
  objectKey: string;
}): S3StorageReference {
  const storage = getCurrentInstanceStorage();

  if (storage.providerKind !== 's3' || !storage.bucket) {
    throw new Error('S3 is not configured for this instance.');
  }

  return {
    provider: 's3',
    objectKey: input.objectKey,
    bucket: storage.bucket,
    ...(storage.region ? { region: storage.region } : {}),
    ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
    ...(storage.basePath ? { basePath: storage.basePath } : {}),
  };
}

export async function resolveConvexReadUrl(
  ctx: StorageCtx | ActionCtx,
  storageId: Id<'_storage'>,
): Promise<SignedReadUrl> {
  const url = await ctx.storage.getUrl(storageId);

  if (!url) {
    return {
      url: null,
      expiresAt: null,
    };
  }

  return {
    url,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}

export function storageReferenceKey(storage: StorageReference): string {
  if (storage.provider === 'convex-files') {
    return `convex-files:${storage.storageId}`;
  }

  return [
    's3',
    storage.bucket,
    storage.region ?? '',
    storage.endpoint ?? '',
    storage.basePath ?? '',
    storage.objectKey,
  ].join(':');
}

export async function deleteStorageReference(
  ctx: MutationCtx | ActionCtx,
  storage: StorageReference,
): Promise<void> {
  if (storage.provider === 'convex-files') {
    const existingUrl = await ctx.storage.getUrl(storage.storageId as Id<'_storage'>);

    if (!existingUrl) {
      return;
    }

    await ctx.storage.delete(storage.storageId as Id<'_storage'>);
    return;
  }

  await deleteS3Object({
    storage,
  });
}

export function formatFeedTimestamp(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const deltaMinutes = Math.max(1, Math.round(deltaMs / 60000));

  if (deltaMinutes < 60) {
    return `Vor ${deltaMinutes} Min.`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `Vor ${deltaHours} Std.`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `Vor ${deltaDays} Tag${deltaDays === 1 ? '' : 'en'}`;
}

export function getS3Region(storage: S3StorageReference): string {
  return storage.region?.trim() || 'us-east-1';
}

export function getS3Endpoint(input: {
  region?: string;
  endpoint?: string;
}): string {
  if (input.endpoint?.trim()) {
    return input.endpoint.trim().replace(/\/+$/, '');
  }

  return `https://s3.${input.region?.trim() || 'us-east-1'}.amazonaws.com`;
}

export function buildS3BucketUrl(input: {
  bucket: string;
  region?: string;
  endpoint?: string;
}): URL {
  return new URL(`${getS3Endpoint(input)}/${input.bucket}`);
}

export function buildS3Url(storage: S3StorageReference): URL {
  const endpoint = getS3Endpoint(storage);
  const basePath = storage.basePath ? `${trimSlashes(storage.basePath)}/` : '';
  const encodedKey = `${basePath}${storage.objectKey}`
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return new URL(`${endpoint}/${storage.bucket}/${encodedKey}`);
}
