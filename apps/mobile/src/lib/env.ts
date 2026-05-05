import Constants from 'expo-constants';

import type { AuthMode, DeploymentKind } from '@beisammen/contracts';

function readExpoExtra(name: string): string | undefined {
  const maybePublicEnv = Constants.expoConfig?.extra?.publicEnv;

  if (!maybePublicEnv || typeof maybePublicEnv !== 'object' || Array.isArray(maybePublicEnv)) {
    return undefined;
  }

  const value = (maybePublicEnv as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalPublicEnv(name: string, fallback = ''): string {
  const processValue = process.env[name];

  if (typeof processValue === 'string' && processValue.length > 0) {
    return processValue;
  }

  const extraValue = readExpoExtra(name);
  return typeof extraValue === 'string' ? extraValue : fallback;
}

function requirePublicEnv(name: string): string {
  const value = readOptionalPublicEnv(name);

  if (value.trim().length > 0) {
    return value;
  }

  throw new Error(
    `Missing required Expo public env var ${name}. Configure it in your mobile env before starting the app.`,
  );
}

function readAuthMode(): AuthMode {
  const mode = requirePublicEnv('EXPO_PUBLIC_DEFAULT_AUTH_MODE');

  if (mode === 'hosted-browser' || mode === 'native-client') {
    return mode;
  }

  throw new Error(
    `Invalid EXPO_PUBLIC_DEFAULT_AUTH_MODE "${mode}". Expected "hosted-browser" or "native-client".`,
  );
}

function readDeploymentKind(): DeploymentKind {
  const deploymentKind = readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND', 'cloud');

  if (deploymentKind === 'cloud' || deploymentKind === 'self-hosted') {
    return deploymentKind;
  }

  throw new Error(
    `Invalid EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND "${deploymentKind}". Expected "cloud" or "self-hosted".`,
  );
}

const defaultInstanceUrl = requirePublicEnv('EXPO_PUBLIC_DEFAULT_INSTANCE_URL');
const defaultConvexUrl = requirePublicEnv('EXPO_PUBLIC_DEFAULT_CONVEX_URL');

export const appEnv = {
  appEnv: readOptionalPublicEnv('EXPO_PUBLIC_APP_ENV', 'development'),
  appVersion: Constants.expoConfig?.version ?? '0.1.0',
  appScheme: readOptionalPublicEnv('EXPO_PUBLIC_APP_SCHEME', 'beisammen'),
  defaultInstanceId: readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_INSTANCE_ID', 'default'),
  defaultInstanceName: readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_INSTANCE_NAME', 'beisammen'),
  defaultInstanceUrl,
  defaultConvexUrl,
  defaultAuthProvider: 'workos' as const,
  defaultAuthMode: readAuthMode(),
  defaultDeploymentKind: readDeploymentKind(),
  defaultAuthClientId: readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_AUTH_CLIENT_ID'),
  defaultAuthSignInUrl: readOptionalPublicEnv('EXPO_PUBLIC_DEFAULT_AUTH_SIGN_IN_URL'),
  logLevel: readOptionalPublicEnv('EXPO_PUBLIC_LOG_LEVEL'),
};
