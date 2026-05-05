import {
  buildInstanceDiscoveryUrl,
  type InstanceConfig,
} from '@beisammen/contracts';

import { appEnv } from '@/lib/env';
import {
  AppVersionUnsupportedError,
  parseDiscoveredInstanceConfig,
} from './validation';

interface ResolveInstanceConfigOptions {
  signal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
  );
}

export async function resolveInstanceConfig(
  baseUrl: string,
  options: ResolveInstanceConfigOptions = {},
): Promise<InstanceConfig> {
  const discoveryUrl = buildInstanceDiscoveryUrl(baseUrl);
  let response: Response;

  try {
    response = await fetch(discoveryUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new Error(
      'Instanz-Konfiguration konnte nicht geladen werden. Prüfe Adresse und Netzwerkverbindung.',
    );
  }

  if (!response.ok) {
    throw new Error(`Instanz-Konfiguration konnte nicht geladen werden (${response.status}).`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error('Instanz-Konfiguration ist kein gültiges JSON.');
  }

  try {
    return parseDiscoveredInstanceConfig({
      payload,
      requestedBaseUrl: baseUrl,
      currentAppVersion: appEnv.appVersion,
    });
  } catch (error) {
    if (error instanceof AppVersionUnsupportedError) {
      throw new Error(
        `Diese Instanz benötigt App-Version ${error.minimumAppVersion} oder neuer. Installiere ein Update und versuche es erneut.`,
      );
    }

    throw new Error(
      `Instanz-Konfiguration ist ungültig: ${
        error instanceof Error ? error.message : 'Unbekannter Fehler.'
      }`,
    );
  }
}
