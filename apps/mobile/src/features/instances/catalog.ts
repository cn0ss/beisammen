import type { PublicConfigValue, InstanceConfig } from '@beisammen/contracts';
import { normalizeBaseUrl } from '@beisammen/contracts';

import { appEnv } from '@/lib/env';

const storageProviders = ['s3'] as const;
const workosCapabilities = ['password', 'email_otp', 'social', 'hosted_sso'] as const;

function buildDefaultSignInUrl(baseUrl: string): string {
  if (appEnv.defaultAuthSignInUrl) {
    return appEnv.defaultAuthSignInUrl;
  }

  return `${baseUrl}/auth/sign-in`;
}

function buildPublicConfig(baseUrl: string) {
  const publicConfig: Record<string, PublicConfigValue> = {
    redirectPath: 'auth/callback',
  };

  if (appEnv.defaultAuthClientId) {
    publicConfig.clientId = appEnv.defaultAuthClientId;
  }

  if (appEnv.defaultAuthMode === 'hosted-browser') {
    publicConfig.signInUrl = buildDefaultSignInUrl(baseUrl);
  }

  return publicConfig;
}

export const defaultInstanceConfig: InstanceConfig = (() => {
  const baseUrl = normalizeBaseUrl(appEnv.defaultInstanceUrl);

  return {
    instance: {
      id: appEnv.defaultInstanceId,
      name: appEnv.defaultInstanceName,
      baseUrl,
    },
    backend: {
      convexUrl: appEnv.defaultConvexUrl,
    },
    auth: {
      provider: 'workos',
      mode: appEnv.defaultAuthMode,
      capabilities: [...workosCapabilities],
      publicConfig: buildPublicConfig(baseUrl),
    },
    features: {
      storageProviders: [...storageProviders],
      selfHosted: baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'),
    },
    client: {
      minimumAppVersion: '0.1.0',
    },
  };
})();
