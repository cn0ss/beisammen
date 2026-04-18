import { useEffect, useState } from 'react';

import { useAction } from 'convex/react';

import { api } from '@/features/convex/api';

export function useSignedAssetUrl(assetId?: string | null) {
  const getReadUrl = useAction(api.assets.getReadUrl);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!assetId) {
      setUrl(null);
      return () => {
        isCancelled = true;
      };
    }

    void getReadUrl({ assetId })
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
  }, [assetId, getReadUrl]);

  return url;
}
