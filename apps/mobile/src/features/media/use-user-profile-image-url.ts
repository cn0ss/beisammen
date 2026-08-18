import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

import type { AvatarImageSource } from './avatar-image-cache';
import { useAvatarImageSource } from './use-avatar-image-source';

/**
 * Resolves any member's custom profile image (falling back to null when they
 * have none or share no circle with the viewer). `profileImageKey` is the
 * stable storage object key delivered on member/author summaries; it doubles
 * as the expo-image cache key, so already-downloaded avatars render without
 * a network round-trip. Callers layer the Clerk avatar underneath:
 * `custom ?? clerkAvatarUrl ?? null`.
 */
export function useUserProfileImage(
  userId: string | null | undefined,
  profileImageKey: string | null | undefined,
): AvatarImageSource | null {
  const getReadUrl = useAction(api.users.getProfileImageReadUrl);

  return useAvatarImageSource(userId ? profileImageKey : null, async () => {
    if (!userId) {
      return null;
    }

    const result = await getReadUrl({ userId });

    return result.url ?? null;
  });
}
