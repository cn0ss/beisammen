import * as Keychain from 'react-native-keychain';

import { fromBase64, toBase64 } from '@beisammen/crypto';

import { createLogger } from '@/lib/logger';

const logger = createLogger('crypto.masterKeyStore');

/**
 * The master key lives in the device keychain, scoped per instance and auth
 * subject (the app can talk to multiple self-hosted instances). On iOS the
 * entry syncs via iCloud Keychain — the pragmatic device-migration path; the
 * recovery code stays the universal fallback (and the only one on Android,
 * where no cross-device keychain exists).
 */
function serviceFor(instanceUrl: string, subject: string): string {
  return `app.beisammen.e2ee.masterKey.${instanceUrl}#${subject}`;
}

const KEYCHAIN_OPTIONS: Keychain.SetOptions & Keychain.GetOptions = {
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  cloudSync: true,
};

export async function saveMasterKey(
  instanceUrl: string,
  subject: string,
  masterKey: Uint8Array,
): Promise<void> {
  await Keychain.setGenericPassword('masterKey', toBase64(masterKey), {
    ...KEYCHAIN_OPTIONS,
    service: serviceFor(instanceUrl, subject),
  });
}

export async function loadMasterKey(
  instanceUrl: string,
  subject: string,
): Promise<Uint8Array | null> {
  try {
    const credentials = await Keychain.getGenericPassword({
      ...KEYCHAIN_OPTIONS,
      service: serviceFor(instanceUrl, subject),
    });

    if (!credentials) {
      return null;
    }

    return fromBase64(credentials.password);
  } catch (error) {
    logger.error('Failed to load master key from keychain.', { error });
    return null;
  }
}

export async function clearMasterKey(instanceUrl: string, subject: string): Promise<void> {
  await Keychain.resetGenericPassword({
    service: serviceFor(instanceUrl, subject),
  });
}
