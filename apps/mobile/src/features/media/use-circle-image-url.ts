import { useEffect, useState } from 'react';

import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

export function useCircleImageUrl(circleId?: string | null, enabled = true) {
  const getReadUrl = useAction(api.circles.getImageReadUrl);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled || !circleId) {
      setUrl(null);
      return () => {
        isCancelled = true;
      };
    }

    void getReadUrl({ circleId })
      .then((result) => {
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
  }, [circleId, enabled, getReadUrl]);

  return url;
}
