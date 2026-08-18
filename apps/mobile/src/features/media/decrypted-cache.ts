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
 * display and playback go through this directory instead. Files live in one
 * subdirectory per circle and are keyed deterministically by asset and
 * variant, which makes repeated renders cache hits, lets expo-image /
 * expo-video reuse stable local URIs, and lets a whole circle's plaintext be
 * dropped when the viewer leaves or is removed.
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
  /** Mime type of the Live Photo companion clip; drives the 'pairedVideo' extension. */
  pairedVideoMimeType?: string;
  fileName?: string;
  encryption: AssetEncryptionEnvelope;
}

export type DecryptedCacheVariant = 'preview' | 'original' | 'pairedVideo';

function circleDirectory(circleId: string): string {
  return `${DECRYPTED_CACHE_DIRECTORY}${circleId}/`;
}

/**
 * Extension for the plaintext file. Derived from server-visible fields only
 * (mime type / kind), so the cache path is computable without unwrapping the
 * file key first.
 */
function extensionForAsset(
  asset: Pick<DecryptedCacheAssetRef, 'kind' | 'mimeType' | 'pairedVideoMimeType'>,
  variant: DecryptedCacheVariant,
): string {
  if (variant === 'preview') {
    // Previews are always re-encoded JPEG thumbnails, for videos too.
    return 'jpg';
  }

  if (variant === 'pairedVideo') {
    // Live Photo companion clips are always short videos.
    return (asset.pairedVideoMimeType ?? '').toLowerCase().includes('quicktime')
      ? 'mov'
      : 'mp4';
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
  asset: Pick<DecryptedCacheAssetRef, '_id' | 'kind' | 'mimeType' | 'pairedVideoMimeType'>,
  variant: DecryptedCacheVariant,
): string {
  return `${asset._id}-${variant}.${extensionForAsset(asset, variant)}`;
}

function decryptedCacheUri(
  circleId: string,
  asset: Pick<DecryptedCacheAssetRef, '_id' | 'kind' | 'mimeType' | 'pairedVideoMimeType'>,
  variant: DecryptedCacheVariant,
): string {
  return `${circleDirectory(circleId)}${decryptedCacheFileName(asset, variant)}`;
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

async function listCircleDirectories(): Promise<string[]> {
  let names: string[];

  try {
    names = await FileSystem.readDirectoryAsync(DECRYPTED_CACHE_DIRECTORY);
  } catch {
    return [];
  }

  const directories: string[] = [];

  for (const name of names) {
    const info = await FileSystem.getInfoAsync(`${DECRYPTED_CACHE_DIRECTORY}${name}`).catch(
      () => null,
    );

    if (info?.exists && info.isDirectory) {
      directories.push(name);
    } else if (info?.exists) {
      // Legacy flat-layout file from before circle scoping; unreachable by the
      // current path scheme, so drop it instead of letting it linger forever.
      await FileSystem.deleteAsync(`${DECRYPTED_CACHE_DIRECTORY}${name}`, {
        idempotent: true,
      }).catch(() => undefined);
    }
  }

  return directories;
}

/**
 * Resolved plaintext URIs for this app session, keyed by cache uri. Lets
 * screens seed their state synchronously on remount instead of flashing a
 * placeholder while the disk is re-checked.
 */
const resolvedUris = new Set<string>();

function forgetResolvedUri(uri: string): void {
  resolvedUris.delete(uri);
}

/**
 * Synchronous session-memoized lookup: returns the plaintext `file://` URI
 * when this session already confirmed it on disk, `null` otherwise. Callers
 * still re-verify asynchronously (the OS may purge the cache directory).
 */
export function peekMemoizedDecryptedUri(
  circleId: string,
  asset: Pick<DecryptedCacheAssetRef, '_id' | 'kind' | 'mimeType' | 'pairedVideoMimeType'>,
  variant: DecryptedCacheVariant,
): string | null {
  const uri = decryptedCacheUri(circleId, asset, variant);

  return resolvedUris.has(uri) ? uri : null;
}

/** Exported with an overridable cap so the eviction order is testable. */
export async function enforceDecryptedCacheLimit(
  maxBytes: number = DECRYPTED_CACHE_MAX_BYTES,
): Promise<void> {
  const circleDirs = await listCircleDirectories();
  const entries: Array<{ uri: string; sizeBytes: number; modifiedAt: number }> = [];

  for (const dirName of circleDirs) {
    const dirUri = `${DECRYPTED_CACHE_DIRECTORY}${dirName}/`;
    let names: string[];

    try {
      names = await FileSystem.readDirectoryAsync(dirUri);
    } catch {
      continue;
    }

    const stats = await Promise.all(
      names.map(async (name) => {
        const uri = `${dirUri}${name}`;
        const stat = await statFile(uri);

        return { uri, ...stat };
      }),
    );

    entries.push(...stats.filter((entry) => entry.exists));
  }

  let totalBytes = entries.reduce((sum, file) => sum + file.sizeBytes, 0);

  if (totalBytes <= maxBytes) {
    return;
  }

  const oldestFirst = [...entries].sort((a, b) => a.modifiedAt - b.modifiedAt);

  for (const file of oldestFirst) {
    if (totalBytes <= maxBytes) {
      break;
    }

    try {
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
      totalBytes -= file.sizeBytes;
      forgetResolvedUri(file.uri);
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
  resolvedUris.clear();
}

/**
 * Deletes every decrypted plaintext file. Called on sign-out, account
 * switch, and account deletion so plaintext media never outlives the session
 * that was authorized to decrypt it.
 */
export async function clearDecryptedMediaCache(): Promise<void> {
  initPromise = null;
  inFlight.clear();
  resolvedUris.clear();
  await FileSystem.deleteAsync(DECRYPTED_CACHE_DIRECTORY, { idempotent: true }).catch(
    () => undefined,
  );
}

/**
 * Deletes one circle's decrypted plaintext. Called when the viewer leaves a
 * circle; removals while the app was closed are caught by
 * `reconcileDecryptedMediaCache` on the next start.
 */
export async function clearCircleDecryptedMedia(circleId: string): Promise<void> {
  const dirUri = circleDirectory(circleId);

  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(`${circleId}/`)) {
      inFlight.delete(key);
    }
  }

  for (const uri of [...resolvedUris]) {
    if (uri.startsWith(dirUri)) {
      resolvedUris.delete(uri);
    }
  }

  await FileSystem.deleteAsync(dirUri, { idempotent: true }).catch(() => undefined);
}

/**
 * Drops cached plaintext of circles the viewer is no longer a member of
 * (left or was removed from while the app was closed). `activeCircleIds`
 * must be the complete membership list; when in doubt callers skip the call
 * rather than pass a partial list.
 */
export async function reconcileDecryptedMediaCache(activeCircleIds: string[]): Promise<void> {
  const active = new Set(activeCircleIds);
  const circleDirs = await listCircleDirectories();

  for (const dirName of circleDirs) {
    if (!active.has(dirName)) {
      await clearCircleDecryptedMedia(dirName);
    }
  }
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Returns the cached plaintext `file://` URI when the variant is already
 * fully decrypted on disk, `null` otherwise. Never downloads; used by video
 * playback to prefer a local file over the range-decrypting proxy, and by
 * display hooks to short-circuit before circle keys are even unlocked.
 */
export async function peekDecryptedAssetUri(
  circleId: string,
  asset: Pick<DecryptedCacheAssetRef, '_id' | 'kind' | 'mimeType' | 'pairedVideoMimeType'>,
  variant: DecryptedCacheVariant,
): Promise<string | null> {
  const targetUri = decryptedCacheUri(circleId, asset, variant);
  const stat = await statFile(targetUri);

  if (!stat.exists) {
    forgetResolvedUri(targetUri);
    return null;
  }

  resolvedUris.add(targetUri);

  return targetUri;
}

export interface GetDecryptedAssetUriInput {
  circleId: string;
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
  const cacheKey = `${input.circleId}/${decryptedCacheFileName(input.asset, input.variant)}`;
  const pending = inFlight.get(cacheKey);

  if (pending) {
    return await pending;
  }

  const promise = resolveDecryptedUri(input).finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, promise);

  return await promise;
}

async function resolveDecryptedUri(input: GetDecryptedAssetUriInput): Promise<string> {
  await ensureInitialized();

  const targetUri = decryptedCacheUri(input.circleId, input.asset, input.variant);
  const existing = await statFile(targetUri);

  if (existing.exists) {
    resolvedUris.add(targetUri);

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

  await FileSystem.makeDirectoryAsync(circleDirectory(input.circleId), {
    intermediates: true,
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

  resolvedUris.add(targetUri);

  return targetUri;
}
