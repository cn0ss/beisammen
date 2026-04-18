import { defineConfig } from 'astro/config';

// Static site with two locales. Browser-language detection happens
// client-side on the root page — `/` ships a tiny script that reads
// `navigator.languages` and forwards to `/en/` or `/de/`.
// A <noscript> meta-refresh + a manual language switcher cover the rest.
export default defineConfig({
  site: 'https://beisammen.app',
  trailingSlash: 'always',
  i18n: {
    locales: ['en', 'de'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
