import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

// Resolve libsodium-wrappers from packages/crypto, where it is a devDependency.
const cryptoRequire = createRequire(
  new URL('../../packages/crypto/package.json', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      'gt-react-native': new URL('./src/test/gt-react-native-mock.ts', import.meta.url).pathname,
      '@': new URL('./src', import.meta.url).pathname,
      '@beisammen/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url)
        .pathname,
      '@beisammen/crypto': new URL('../../packages/crypto/src/index.ts', import.meta.url).pathname,
      '@beisammen/upload-client': new URL('../../packages/upload-client/src/index.ts', import.meta.url)
        .pathname,
      // The package's ESM build imports a sibling libsodium.mjs that is not
      // shipped; the CJS build bundles everything and works under vitest.
      'libsodium-wrappers': cryptoRequire.resolve('libsodium-wrappers'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
