# Mobile App

Expo Router app for Beisammen.

## Notes

- this package now contains a minimal real foundation
- Clerk login runs through Convex authentication
- Convex is wired into the app via `ConvexProviderWithClerk`
- no demo data or marketing mock screens remain
- only public `EXPO_PUBLIC_*` variables may be used here

## Internationalization (gt-react-native)

Source language is German (`de`), translated to English (`en`). Config lives in
`gt.config.json`; translation files are generated into `src/_gt/` and are
committed so builds work without credentials.

- JSX copy is wrapped in `<T>` (dynamic values in `<Var>`/`<Num>`/`<DateTime>`),
  prop/imperative strings use `useGT()` with ICU placeholders, and module-level
  copy is registered with `msg()` and rendered through `useMessages()`.
- Dates use `useDateFormat` (`src/i18n/use-date-format.ts`) so formatting
  follows the active locale instead of a hardcoded `de-DE`.
- After changing user-facing copy, run `pnpm translate` (needs `GT_PROJECT_ID`
  and `GT_API_KEY`, e.g. from `.env.local`) and commit the updated `src/_gt/`
  files. EAS builds also run `scripts/gt-translate.js` via the
  `eas-build-post-install` hook when those keys are configured as EAS secrets,
  so store builds always ship fresh translations.
- The locale is auto-detected from the device; iOS permission strings are
  localized via `locales/de.json` / `locales/en.json`.

## Subscriptions and EAS builds

RevenueCat is intentionally store-separated:

- `development` uses the RevenueCat Test Store on iOS and Android. Test
  purchases are simulated and never reach Apple or Google.
- `preview` and `store-sandbox` use the real platform SDK keys. Use
  `store-sandbox` for TestFlight or Google Play internal-track purchase tests.
- `production` only accepts `appl_` on iOS and `goog_` on Android. A Test Store
  key cannot be selected by a production build.

Useful commands from this directory:

```sh
# Inspect the linked EAS project and resolved build configuration.
pnpm eas project:info
pnpm eas config --platform ios --profile production

# Development clients for direct device testing.
pnpm eas build --platform ios --profile development
pnpm eas build --platform android --profile development

# Store-signed sandbox builds for TestFlight / Play internal testing.
pnpm eas build --platform ios --profile store-sandbox
pnpm eas build --platform android --profile store-sandbox
pnpm eas submit --platform ios --profile store-sandbox
pnpm eas submit --platform android --profile store-sandbox

# Or build and submit Android to Play's internal track in one command.
pnpm eas build --platform android --profile store-sandbox --auto-submit

# Production store builds. This does not submit them.
pnpm eas build --platform all --profile production

# Submit an already-built artifact only when a release is intended.
pnpm eas submit --platform ios --profile production
pnpm eas submit --platform android --profile production
```

EAS build-time public variables live in the EAS `development`, `preview`, and
`production` environments. Local EAS project linkage is loaded from the ignored
`.eas.local`; normal app development continues to use the ignored `.env.local`.
