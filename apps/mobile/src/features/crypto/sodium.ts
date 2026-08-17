import sodium from 'react-native-libsodium';

import type { SodiumApi } from '@beisammen/crypto';

let readySodium: Promise<SodiumApi> | null = null;

/**
 * react-native-libsodium mirrors the libsodium-wrappers API, which is the
 * exact surface @beisammen/crypto expects; the cast just narrows it.
 */
export function getSodium(): Promise<SodiumApi> {
  if (!readySodium) {
    readySodium = sodium.ready.then(() => sodium as unknown as SodiumApi);
  }

  return readySodium;
}
