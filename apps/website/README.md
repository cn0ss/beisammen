# @beisammen/website

Marketing site for Beisammen — React + Vite + Tailwind CSS v4, with EN / DE support.
UI primitives are vendored from [ReUI](https://reui.io) (Base UI + nova style) in
`src/components/ui`, and motion uses transitions.dev Pro recipes (`src/styles/transitions.css`).

## Scripts

```bash
pnpm --filter @beisammen/website dev       # local dev server
pnpm --filter @beisammen/website build     # production build → ./dist
pnpm --filter @beisammen/website preview   # preview the production build
```

## Deployment

The site is served by Cloudflare Workers (static assets) as the Worker
`beisammen-website`, with `beisammen.app` and `www.beisammen.app` attached as
custom domains (www 301s to the apex via `worker/index.ts`).

```bash
pnpm --filter @beisammen/website deploy   # build + wrangler deploy
```

Pushes to `main` that touch `apps/website/**` deploy automatically via
`.github/workflows/deploy-website.yml` (requires the `CLOUDFLARE_API_TOKEN`
repository secret, scoped to Edit Cloudflare Workers). Manual deploys use the
command above. SPA fallback and trailing-slash handling live in
`wrangler.jsonc` (`assets.not_found_handling` / `html_handling`).

## Environment

- `PUBLIC_INSTANCE_BASE_URL` must point at the backend base URL that serves Convex HTTP actions.
  The production value is committed in `.env.production` (it is public and baked into the bundle);
  Vite picks it up automatically during `pnpm build`.
- `PUBLIC_WEB_BASE_URL` should point at this web frontend. Convex uses it when creating public circle links.
- The waitlist form submits to `${PUBLIC_INSTANCE_BASE_URL}/waitlist/join` (the backend expects `source=landing`).
- The public circle viewer loads from `/share/#<token>` and fetches media through `${PUBLIC_INSTANCE_BASE_URL}/public/share/preview`.

## Routing model

Single-page app (react-router); Cloudflare Workers serves `index.html` for
unknown paths (`not_found_handling: "single-page-application"`), while the
prerendered per-route heads in `dist/<route>/index.html` are served as real
assets.

| Path                 | What it serves |
| -------------------- | -------------- |
| `/`                  | German landing page. On first visit it honors `localStorage['beisammen:lang']`, then the browser language, and forwards English readers to `/en/`. |
| `/en/`               | English landing page |
| `/privacy/`, `/en/privacy/` | Privacy policy |
| `/delete-account/`, `/en/delete-account/` | Account deletion instructions |
| `/share/`            | No-install public viewer for revocable circle links (German) |

Manual language switcher clicks write `beisammen:lang` to `localStorage`, so an
override is remembered on future visits to `/`.

## Adding ReUI components

`components.json` is configured for the `@reui` registry (`base-nova` style), which
requires a ReUI license key. Without one, vendor components from the MIT-licensed
[keenthemes/reui](https://github.com/keenthemes/reui) repo (`registry/bases/base/ui/*`)
into `src/components/ui` and fix the `@/registry/...` imports to `@/lib/utils` /
`@/components/ui`; their styling comes from `src/styles/reui-nova.css`.
