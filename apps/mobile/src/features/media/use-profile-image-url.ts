import { useEffect, useState } from 'react';

import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

export function useProfileImageUrl(enabled: boolean) {
  const getReadUrl = useAction(api.users.getProfileImageReadUrl);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled) {
      setUrl(null);
      return () => {
        isCancelled = true;
      };
    }

    void getReadUrl({})
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
  }, [enabled, getReadUrl]);

  return url;
}
