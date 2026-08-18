import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

import type { AvatarImageSource } from './avatar-image-cache';
import { useAvatarImageSource } from './use-avatar-image-source';

/**
 * Resolves the viewer's own custom profile image. `profileImageKey` comes from
 * the viewer record and doubles as the expo-image cache key, so a cached
 * avatar renders without any network round-trip.
 */
export function useProfileImage(
  profileImageKey: string | null | undefined,
): AvatarImageSource | null {
  const getReadUrl = useAction(api.users.getProfileImageReadUrl);

  return useAvatarImageSource(profileImageKey, async () => {
    const result = await getReadUrl({});

    return result.url ?? null;
  });
}
