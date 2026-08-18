import { Image } from 'expo-image';

/**
 * Display source for an avatar (user profile or circle image). `cacheKey` is
 * the storage object key: stable across URL re-signing, replaced on every new
 * upload. expo-image keys its disk cache by it, so the rotating signature in
 * presigned URLs never causes a re-download, and cached avatars survive app
 * restarts without any network round-trip.
 */
export interface AvatarImageSource {
  uri: string;
  cacheKey: string;
}

/**
 * What avatar consumers render: a resolved cached source, a plain stable URL
 * (e.g. the Clerk-hosted fallback avatar), or nothing.
 */
export type AvatarImage = string | AvatarImageSource | null;

/** Session memory of resolved sources so remounting screens render instantly. */
const resolvedSources = new Map<string, AvatarImageSource>();
const inFlight = new Map<string, Promise<AvatarImageSource | null>>();

export function peekAvatarImageSource(cacheKey: string): AvatarImageSource | null {
  return resolvedSources.get(cacheKey) ?? null;
}

/**
 * Resolves a renderable source for the given cache key: the expo-image disk
 * cache entry when one exists (no network), otherwise a freshly signed URL.
 * Concurrent callers for the same key share one in-flight resolution.
 */
export async function resolveAvatarImageSource(input: {
  cacheKey: string;
  getSignedUrl: () => Promise<string | null>;
}): Promise<AvatarImageSource | null> {
  const cached = resolvedSources.get(input.cacheKey);

  if (cached) {
    return cached;
  }

  const pending = inFlight.get(input.cacheKey);

  if (pending) {
    return await pending;
  }

  const promise = (async (): Promise<AvatarImageSource | null> => {
    const cachePath = await Image.getCachePathAsync(input.cacheKey).catch(() => null);

    if (cachePath) {
      const source: AvatarImageSource = {
        uri: cachePath.startsWith('/') ? `file://${cachePath}` : cachePath,
        cacheKey: input.cacheKey,
      };

      resolvedSources.set(input.cacheKey, source);

      return source;
    }

    const url = await input.getSignedUrl();

    if (!url) {
      return null;
    }

    // Rendering this source stores the downloaded bytes under the cache key,
    // so the next session resolves via the disk-cache branch above.
    const source: AvatarImageSource = { uri: url, cacheKey: input.cacheKey };

    resolvedSources.set(input.cacheKey, source);

    return source;
  })().finally(() => {
    inFlight.delete(input.cacheKey);
  });

  inFlight.set(input.cacheKey, promise);

  return await promise;
}

/**
 * Forgets every cached avatar: session memory plus expo-image's disk and
 * memory caches. Called on sign-out and account switch so avatars do not
 * leak into the next session or account.
 */
export async function clearAvatarImageCache(): Promise<void> {
  resolvedSources.clear();
  inFlight.clear();
  await Image.clearDiskCache().catch(() => undefined);
  await Image.clearMemoryCache().catch(() => undefined);
}

/** Test hook. */
export function resetAvatarImageCacheForTesting(): void {
  resolvedSources.clear();
  inFlight.clear();
}
