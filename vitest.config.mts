import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@beisammen/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
  },
});
