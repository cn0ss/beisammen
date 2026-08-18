import { useEffect, useEffectEvent, useState } from 'react';

import {
  peekAvatarImageSource,
  resolveAvatarImageSource,
  type AvatarImageSource,
} from './avatar-image-cache';

/**
 * Resolves an avatar display source for a stable cache key. Session-memoized
 * results render synchronously (no placeholder flash on remounts); otherwise
 * the expo-image disk cache is consulted before `getSignedUrl` is invoked, so
 * the signing action only runs for avatars not on disk yet.
 */
export function useAvatarImageSource(
  cacheKey: string | null | undefined,
  getSignedUrl: () => Promise<string | null>,
): AvatarImageSource | null {
  const [source, setSource] = useState<AvatarImageSource | null>(() =>
    cacheKey ? peekAvatarImageSource(cacheKey) : null,
  );
  const fetchSignedUrl = useEffectEvent(getSignedUrl);

  useEffect(() => {
    if (!cacheKey) {
      setSource(null);
      return;
    }

    const cached = peekAvatarImageSource(cacheKey);

    setSource(cached);

    if (cached) {
      return;
    }

    let isCancelled = false;

    resolveAvatarImageSource({ cacheKey, getSignedUrl: fetchSignedUrl })
      .then((resolved) => {
        if (!isCancelled) {
          setSource(resolved);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSource(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [cacheKey]);

  return source;
}
