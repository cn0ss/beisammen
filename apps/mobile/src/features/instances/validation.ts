import {
  assertAppVersionSupported,
  assertInstanceBaseUrlMatches,
  parseInstanceConfig,
  type InstanceConfig,
} from '@beisammen/contracts';

export class AppVersionUnsupportedError extends Error {
  readonly minimumAppVersion: string;

  constructor(minimumAppVersion: string) {
    super(`This instance requires app version ${minimumAppVersion} or newer.`);
    this.name = 'AppVersionUnsupportedError';
    this.minimumAppVersion = minimumAppVersion;
  }
}

export function parseDiscoveredInstanceConfig(input: {
  payload: unknown;
  requestedBaseUrl: string;
  currentAppVersion: string;
}): InstanceConfig {
  const parsed = parseInstanceConfig(input.payload);
  assertInstanceBaseUrlMatches(parsed, input.requestedBaseUrl);

  try {
    assertAppVersionSupported(input.currentAppVersion, parsed.client.minimumAppVersion);
  } catch {
    throw new AppVersionUnsupportedError(parsed.client.minimumAppVersion);
  }

  return parsed;
}
