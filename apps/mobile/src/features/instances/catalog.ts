import type { InstanceConfig } from '@beisammen/contracts';
import { buildClerkInstanceConfig, normalizeBaseUrl } from '@beisammen/contracts';

import { appEnv } from '@/lib/env';

export const defaultInstanceConfig: InstanceConfig = (() => {
  const baseUrl = normalizeBaseUrl(appEnv.defaultInstanceUrl);

  return buildClerkInstanceConfig({
    id: appEnv.defaultInstanceId || 'default',
    name: appEnv.defaultInstanceName || 'beisammen',
    baseUrl,
    convexUrl: appEnv.defaultConvexUrl,
    authPublishableKey: appEnv.clerkPublishableKey,
    deploymentKind: appEnv.defaultDeploymentKind,
    minimumAppVersion: appEnv.appVersion,
  });
})();
