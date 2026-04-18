# @beisammen/landing

Static Astro landing page for Beisammen, with EN / DE support and automatic browser-language detection.

## Scripts

```bash
pnpm --filter @beisammen/landing dev       # local dev server
pnpm --filter @beisammen/landing build     # static build → ./dist
pnpm --filter @beisammen/landing preview   # preview the static build
```

## Environment

- `PUBLIC_INSTANCE_BASE_URL` must point at the backend base URL that serves Convex HTTP actions.
- The waitlist form submits to `${PUBLIC_INSTANCE_BASE_URL}/waitlist/join`.

## Routing model

| Path   | What it serves |
| ------ | -------------- |
| `/`    | Tiny redirect page. Client JS inspects `localStorage['beisammen:lang']` first, then `navigator.languages`, and forwards to `/en/` or `/de/`. `<noscript>` falls back to `/en/` via `<meta http-equiv="refresh">`, and a manual language picker renders if no redirect fires. |
| `/en/` | English landing page |
| `/de/` | German landing page  |

`astro.config.mjs` uses Astro's built-in `i18n` with `prefixDefaultLocale: true`, which keeps Astro from auto-generating a conflicting `/` route and lets us own the root page for redirection logic.

Manual language switcher clicks write `beisammen:lang` to `localStorage`, so a user who overrides detection once is remembered on future visits to `/`.

## Why client-side detection?

Astro's server-side `Astro.preferredLocale` requires SSR. The landing page is static by design (cheap to host, CDN-friendly), so language detection happens on the client. The layered fallbacks cover JS-disabled, bot, and first-time-visitor cases.
