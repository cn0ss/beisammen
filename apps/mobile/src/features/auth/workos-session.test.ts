import { describe, expect, test } from 'vitest';

import { buildWorkOSInstanceConfig } from '@beisammen/contracts';

import {
  buildWorkOSSessionResult,
  readTokenClaims,
  readTokenExpiry,
} from './workos-session';

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url(payload)}.`;
}

const instance = buildWorkOSInstanceConfig({
  id: 'cloud',
  name: 'Cloud',
  baseUrl: 'https://cloud.example.com',
  convexUrl: 'https://cloud.convex.cloud',
  authMode: 'native-client',
  authClientId: 'client_123',
  deploymentKind: 'cloud',
  minimumAppVersion: '0.1.0',
});

describe('WorkOS session parsing', () => {
  test('normalizes token claims and user profile fields', () => {
    const accessToken = unsignedJwt({
      iss: 'https://api.workos.com/user_management/client_123',
      aud: 'convex',
      sub: 'user_123',
      exp: 1_800_000_000,
    });

    expect(readTokenExpiry(accessToken)).toBe(1_800_000_000_000);
    expect(readTokenClaims(accessToken)).toMatchObject({
      aud: 'convex',
      sub: 'user_123',
    });

    expect(
      buildWorkOSSessionResult(instance, {
        access_token: accessToken,
        refresh_token: 'refresh_123',
        user: {
          id: 'user_123',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          profile_picture_url: 'https://example.com/avatar.jpg',
        },
      }),
    ).toMatchObject({
      accessToken,
      refreshToken: 'refresh_123',
      session: {
        instanceUrl: 'https://cloud.example.com',
        subject: 'user_123',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        avatarUrl: 'https://example.com/avatar.jpg',
        expiresAt: 1_800_000_000_000,
      },
    });
  });

  test('rejects WorkOS payloads without a stable user id', () => {
    expect(() => buildWorkOSSessionResult(instance, {})).toThrow(/user id/i);
  });
});
