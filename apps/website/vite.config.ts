import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keeps the PUBLIC_* env contract from the previous Astro app so existing
  // Vercel env vars (PUBLIC_INSTANCE_BASE_URL) continue to work unchanged.
  envPrefix: ['VITE_', 'PUBLIC_'],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // The workspace uses node-linker=hoisted and the mobile app pins a
    // different React patch release — without dedupe the bundle ships two
    // React copies and hooks break at runtime.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    allowedHosts: ['beisammen-40.localcan.dev'],
  },
});
