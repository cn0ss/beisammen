import { Resend } from '@convex-dev/resend';

import { components } from './_generated/api';

/**
 * Shared Resend client. testMode stays on (sends only reach resend.dev test
 * addresses) until RESEND_TEST_MODE=false is set alongside a production
 * RESEND_API_KEY, mirroring the RevenueCat key guards.
 */
export const resend: Resend = new Resend(components.resend, {
  testMode: (process.env.RESEND_TEST_MODE ?? 'true') !== 'false',
});

export function isEmailConfigured(): boolean {
  const value = process.env.RESEND_API_KEY;

  return Boolean(value && value.trim().length > 0);
}

export function retentionEmailFrom(): string {
  return process.env.RETENTION_EMAIL_FROM ?? 'Beisammen <no-reply@beisammen.app>';
}
