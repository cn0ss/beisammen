import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'gt-react-native': new URL('./src/test/gt-react-native-mock.ts', import.meta.url).pathname,
      '@': new URL('./src', import.meta.url).pathname,
      '@beisammen/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url)
        .pathname,
      '@beisammen/upload-client': new URL('../../packages/upload-client/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
