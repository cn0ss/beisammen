import { useEffect, useState } from 'react';

import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

interface CachedProfileImageUrl {
  url: string | null;
  expiresAt: number | null;
}

/** Signed URLs are cached per user so lists (activity, feed) don't refetch per row. */
const profileImageUrlCache = new Map<string, CachedProfileImageUrl>();
const EXPIRY_MARGIN_MS = 30_000;

function readFreshCache(userId: string | null | undefined): string | null {
  if (!userId) {
    return null;
  }

  const cached = profileImageUrlCache.get(userId);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt !== null && cached.expiresAt <= Date.now() + EXPIRY_MARGIN_MS) {
    profileImageUrlCache.delete(userId);
    return null;
  }

  return cached.url;
}

/**
 * Resolves any member's custom profile image (falling back to null when they
 * have none or share no circle with the viewer). Callers layer the Clerk
 * avatar underneath: `custom ?? clerkAvatarUrl ?? null`.
 */
export function useUserProfileImageUrl(
  userId: string | null | undefined,
  hasProfileImage: boolean,
): string | null {
  const getReadUrl = useAction(api.users.getProfileImageReadUrl);
  const [url, setUrl] = useState<string | null>(() =>
    hasProfileImage ? readFreshCache(userId) : null,
  );

  useEffect(() => {
    let isCancelled = false;

    if (!userId || !hasProfileImage) {
      setUrl(null);
      return () => {
        isCancelled = true;
      };
    }

    const cached = readFreshCache(userId);

    if (cached !== null) {
      setUrl(cached);
      return () => {
        isCancelled = true;
      };
    }

    void getReadUrl({ userId })
      .then((result) => {
        profileImageUrlCache.set(userId, {
          url: result.url ?? null,
          expiresAt: result.expiresAt ?? null,
        });

        if (!isCancelled) {
          setUrl(result.url ?? null);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setUrl(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [getReadUrl, hasProfileImage, userId]);

  return url;
}
