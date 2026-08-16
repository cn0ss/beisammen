import { describe, expect, test } from 'vitest';

import { shouldRedirectToOnboarding } from './routing';

describe('onboarding routing', () => {
  test('redirects signed-in users with no circles and no pending invite', () => {
    expect(
      shouldRedirectToOnboarding({
        hasViewer: true,
        circlesLoaded: true,
        circleCount: 0,
        pendingInviteToken: null,
      }),
    ).toBe(true);
  });

  test('keeps pending invite users on the invite path instead of creator onboarding', () => {
    expect(
      shouldRedirectToOnboarding({
        hasViewer: true,
        circlesLoaded: true,
        circleCount: 0,
        pendingInviteToken: 'invite-token',
      }),
    ).toBe(false);
  });

  test('does not redirect before viewer circles are loaded', () => {
    expect(
      shouldRedirectToOnboarding({
        hasViewer: true,
        circlesLoaded: false,
        circleCount: 0,
        pendingInviteToken: null,
      }),
    ).toBe(false);
  });
});
