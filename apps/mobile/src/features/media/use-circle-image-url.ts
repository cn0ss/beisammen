import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

import type { AvatarImageSource } from './avatar-image-cache';
import { useAvatarImageSource } from './use-avatar-image-source';

/**
 * Resolves a circle's image. `imageKey` comes from the circle summary and
 * doubles as the expo-image cache key, so a cached image renders without any
 * network round-trip.
 */
export function useCircleImage(
  circleId: string | null | undefined,
  imageKey: string | null | undefined,
): AvatarImageSource | null {
  const getReadUrl = useAction(api.circles.getImageReadUrl);

  return useAvatarImageSource(circleId ? imageKey : null, async () => {
    if (!circleId) {
      return null;
    }

    const result = await getReadUrl({ circleId });

    return result.url ?? null;
  });
}
