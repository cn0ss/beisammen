import { Platform } from 'react-native';

/**
 * Legal documents linked from the purchase flow. App Store guideline 3.1.2
 * requires functional Terms of Use (EULA) and privacy policy links inside the
 * app wherever auto-renewable subscriptions are offered; Google Play expects
 * the privacy policy to be reachable as well.
 */

const WEBSITE_BASE_URL = 'https://beisammen.app';

/** Apple's standard EULA applies to App Store distribution (no custom EULA). */
const APPLE_STANDARD_EULA_URL =
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export function privacyPolicyUrl(locale: string): string {
  return locale.toLowerCase().startsWith('en')
    ? `${WEBSITE_BASE_URL}/en/privacy`
    : `${WEBSITE_BASE_URL}/privacy`;
}

/** Terms of Use (EULA); null where no store-specific terms document applies. */
export function termsOfUseUrl(): string | null {
  return Platform.OS === 'ios' ? APPLE_STANDARD_EULA_URL : null;
}
