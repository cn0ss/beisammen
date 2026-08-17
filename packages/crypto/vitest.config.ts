import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      // The package's ESM build imports a sibling libsodium.mjs that is not
      // shipped; the CJS build bundles everything and works under vitest.
      'libsodium-wrappers': require.resolve('libsodium-wrappers'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
