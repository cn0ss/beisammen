import type { InstanceConfig } from '@beisammen/contracts';
import { buildWorkOSInstanceConfig, normalizeBaseUrl } from '@beisammen/contracts';

import { appEnv } from '@/lib/env';

export const defaultInstanceConfig: InstanceConfig = (() => {
  const baseUrl = normalizeBaseUrl(appEnv.defaultInstanceUrl);

  return buildWorkOSInstanceConfig({
    id: appEnv.defaultInstanceId || 'default',
    name: appEnv.defaultInstanceName || 'beisammen',
    baseUrl,
    convexUrl: appEnv.defaultConvexUrl,
    authMode: appEnv.defaultAuthMode,
    authClientId: appEnv.defaultAuthClientId,
    authSignInUrl: appEnv.defaultAuthSignInUrl,
    deploymentKind: appEnv.defaultDeploymentKind,
    minimumAppVersion: appEnv.appVersion,
  });
})();
