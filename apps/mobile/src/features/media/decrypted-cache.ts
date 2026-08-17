import * as FileSystem from 'expo-file-system/legacy';

import {
  unwrapAssetFileKey,
  type AssetEncryptionEnvelope,
} from '@/features/crypto/asset-metadata';
import { decryptFileToFile } from '@/features/crypto/file-crypto';
import { getSodium } from '@/features/crypto/sodium';

/**
 * On-device cache of decrypted media plaintext. Encrypted assets can never be
 * rendered straight from their signed URL (the object is BSE1 ciphertext), so
 * display and playback go through this directory instead. Files are keyed
 * deterministically by asset and variant, which makes repeated renders cache
 * hits and lets expo-image / expo-video reuse stable local URIs.
 */
export const DECRYPTED_CACHE_DIRECTORY = `${FileSystem.cacheDirectory ?? ''}decrypted-media/`;

/**
 * Soft size cap enforced once per app session on first cache access: when the
 * directory exceeds this, the oldest files (by modification time) are deleted
 * until it fits again. 512 MiB keeps a comfortable working set of originals
 * (videos included) while bounding disk usage; the OS may additionally purge
 * the cache directory under storage pressure.
 */
export const DECRYPTED_CACHE_MAX_BYTES = 512 * 1024 * 1024;

export interface DecryptedCacheAssetRef {
  _id: string;
  kind: 'image' | 'video';
  mimeType?: string;
  fileName?: string;
  encryption: AssetEncryptionEnvelope;
}

export type DecryptedCacheVariant = 'preview' | 'original';

/**
 * Extension for the plaintext file. Derived from server-visible fields only
 * (mime type / kind), so the cache path is computable without unwrapping the
 * file key first.
 */
function extensionForAsset(
  asset: Pick<DecryptedCacheAssetRef, 'kind' | 'mimeType'>,
  variant: DecryptedCacheVariant,
): string {
  if (variant === 'preview') {
    // Previews are always re-encoded JPEG thumbnails, for videos too.
    return 'jpg';
  }

  const mime = asset.mimeType?.toLowerCase() ?? '';

  if (mime.includes('png')) {
    return 'png';
  }

  if (mime.includes('webp')) {
    return 'webp';
  }

  if (mime.includes('gif')) {
    return 'gif';
  }

  if (mime.includes('heic') || mime.includes('heif')) {
    return 'heic';
  }

  if (mime.includes('quicktime')) {
    return 'mov';
  }

  if (mime.includes('webm')) {
    return 'webm';
  }

  if (asset.kind === 'video') {
    return 'mp4';
  }

  return 'jpg';
}

export function decryptedCacheFileName(
  asset: Pick<DecryptedCacheAssetRef, '_id' | 'kind' | 'mimeType'>,
  variant: DecryptedCacheVariant,
): string {
  return `${asset._id}-${variant}.${extensionForAsset(asset, variant)}`;
}

async function statFile(uri: string): Promise<{
  exists: boolean;
  sizeBytes: number;
  modifiedAt: number;
}> {
  const info = await FileSystem.getInfoAsync(uri);

  if (!info.exists || info.isDirectory) {
    return { exists: false, sizeBytes: 0, modifiedAt: 0 };
  }

  return {
    exists: true,
    sizeBytes: info.size ?? 0,
    modifiedAt: info.modificationTime ?? 0,
  };
}

/** Exported with an overridable cap so the eviction order is testable. */
export async function enforceDecryptedCacheLimit(
  maxBytes: number = DECRYPTED_CACHE_MAX_BYTES,
): Promise<void> {
  let names: string[];

  try {
    names = await FileSystem.readDirectoryAsync(DECRYPTED_CACHE_DIRECTORY);
  } catch {
    return;
  }

  const entries = await Promise.all(
    names.map(async (name) => {
      const uri = `${DECRYPTED_CACHE_DIRECTORY}${name}`;
      const stat = await statFile(uri);

      return { uri, ...stat };
    }),
  );
  const files = entries.filter((entry) => entry.exists);
  let totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  if (totalBytes <= maxBytes) {
    return;
  }

  const oldestFirst = [...files].sort((a, b) => a.modifiedAt - b.modifiedAt);

  for (const file of oldestFirst) {
    if (totalBytes <= maxBytes) {
      break;
    }

    try {
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
      totalBytes -= file.sizeBytes;
    } catch {
      // A file in active use may resist deletion; skip it and keep trimming.
    }
  }
}

let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  initPromise ??= (async () => {
    await FileSystem.makeDirectoryAsync(DECRYPTED_CACHE_DIRECTORY, { intermediates: true });

    try {
      await enforceDecryptedCacheLimit();
    } catch {
      // Cleanup is best-effort; a failed sweep must not block media display.
    }
  })();

  return initPromise;
}

/** Test hook: forgets the memoized init so cleanup runs again. */
export function resetDecryptedCacheForTesting(): void {
  initPromise = null;
  inFlight.clear();
}

/**
 * Returns the cached plaintext `file://` URI when the variant is already
 * fully decrypted on disk, `null` otherwise. Never downloads; used by video
 * playback to prefer a local file over the range-decrypting proxy.
 */
export async function peekDecryptedAssetUri(
  asset: Pick<DecryptedCacheAssetRef, '_id' | 'kind' | 'mimeType'>,
  variant: DecryptedCacheVariant,
): Promise<string | null> {
  const targetUri = `${DECRYPTED_CACHE_DIRECTORY}${decryptedCacheFileName(asset, variant)}`;
  const stat = await statFile(targetUri);

  return stat.exists ? targetUri : null;
}

const inFlight = new Map<string, Promise<string>>();

export interface GetDecryptedAssetUriInput {
  asset: DecryptedCacheAssetRef;
  variant: DecryptedCacheVariant;
  signedUrl?: string;
  getSignedUrl?: () => Promise<string | null>;
  keysByEpoch: Map<number, Uint8Array>;
}

/**
 * Returns a local `file://` URI holding the decrypted plaintext for the asset
 * variant, downloading and decrypting on a cache miss. Concurrent callers for
 * the same asset/variant share one in-flight promise.
 */
export async function getDecryptedAssetUri(input: GetDecryptedAssetUriInput): Promise<string> {
  const cacheFileName = decryptedCacheFileName(input.asset, input.variant);
  const pending = inFlight.get(cacheFileName);

  if (pending) {
    return await pending;
  }

  const promise = resolveDecryptedUri(input, cacheFileName).finally(() => {
    inFlight.delete(cacheFileName);
  });

  inFlight.set(cacheFileName, promise);

  return await promise;
}

async function resolveDecryptedUri(
  input: GetDecryptedAssetUriInput,
  cacheFileName: string,
): Promise<string> {
  await ensureInitialized();

  const targetUri = `${DECRYPTED_CACHE_DIRECTORY}${cacheFileName}`;
  const existing = await statFile(targetUri);

  if (existing.exists) {
    return targetUri;
  }

  const signedUrl = input.signedUrl ?? (input.getSignedUrl ? await input.getSignedUrl() : null);

  if (!signedUrl) {
    throw new Error('Datei ist nicht mehr im Speicher vorhanden.');
  }

  const sodium = await getSodium();
  const fileKey = unwrapAssetFileKey({
    sodium,
    envelope: input.asset.encryption,
    keysByEpoch: input.keysByEpoch,
  });
  const ciphertextUri = `${targetUri}.ciphertext`;
  // Decrypt into a partial file and move at the end, so a crash mid-decrypt
  // never leaves a truncated file behind that would count as a cache hit.
  const partialUri = `${targetUri}.partial`;

  try {
    await FileSystem.downloadAsync(signedUrl, ciphertextUri);
    await decryptFileToFile({
      sodium,
      fileKey,
      sourceUri: ciphertextUri,
      targetUri: partialUri,
    });
    await FileSystem.moveAsync({ from: partialUri, to: targetUri });
  } finally {
    await FileSystem.deleteAsync(ciphertextUri, { idempotent: true }).catch(() => undefined);
    await FileSystem.deleteAsync(partialUri, { idempotent: true }).catch(() => undefined);
  }

  return targetUri;
}
