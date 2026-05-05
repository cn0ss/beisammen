import type { AppSession, AuthSessionResult, InstanceConfig } from '@beisammen/contracts';

export function buildDisplayName(user: {
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
}): string | undefined {
  if (user.displayName) {
    return user.displayName;
  }

  const joinedName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  if (joinedName) {
    return joinedName;
  }

  return user.email;
}

export function buildSession(
  instance: InstanceConfig,
  input: {
    subject: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    expiresAt?: number;
  },
): AppSession {
  return {
    instanceUrl: instance.instance.baseUrl,
    provider: instance.auth.provider,
    subject: input.subject,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    expiresAt: input.expiresAt,
    capabilities: instance.auth.capabilities,
  };
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return globalThis.atob(`${normalized}${padding}`);
}

export function readTokenExpiry(accessToken?: string): number | undefined {
  if (!accessToken) {
    return undefined;
  }

  try {
    const [, payload] = accessToken.split('.');

    if (!payload) {
      return undefined;
    }

    const decoded = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };

    if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
      return decoded.exp * 1000;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function readTokenClaims(accessToken?: string): {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
} | null {
  if (!accessToken) {
    return null;
  }

  try {
    const [, payload] = accessToken.split('.');

    if (!payload) {
      return null;
    }

    const decoded = JSON.parse(decodeBase64Url(payload)) as {
      iss?: unknown;
      aud?: unknown;
      sub?: unknown;
      exp?: unknown;
    };

    return {
      iss: typeof decoded.iss === 'string' ? decoded.iss : undefined,
      aud:
        typeof decoded.aud === 'string' ||
        (Array.isArray(decoded.aud) && decoded.aud.every((value) => typeof value === 'string'))
          ? (decoded.aud as string | string[])
          : undefined,
      sub: typeof decoded.sub === 'string' ? decoded.sub : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    };
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getString(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return undefined;
}

export function getRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const candidate = value[key];

  if (!isRecord(candidate)) {
    return null;
  }

  return candidate;
}

export function buildWorkOSSessionResult(
  instance: InstanceConfig,
  payload: Record<string, unknown>,
): AuthSessionResult {
  const accessToken = getString(payload, 'access_token', 'accessToken');
  const user = getRecord(payload, 'user');
  const subject =
    getString(user ?? {}, 'id') ??
    getString(payload, 'user_id', 'userId', 'subject');

  if (!subject) {
    throw new Error('WorkOS response did not include a user id.');
  }

  const email =
    getString(user ?? {}, 'email') ??
    getString(payload, 'email');
  const displayName = buildDisplayName({
    email,
    displayName:
      getString(user ?? {}, 'display_name', 'displayName') ??
      getString(payload, 'display_name', 'displayName'),
    firstName:
      getString(user ?? {}, 'first_name', 'firstName') ??
      getString(payload, 'first_name', 'firstName'),
    lastName:
      getString(user ?? {}, 'last_name', 'lastName') ??
      getString(payload, 'last_name', 'lastName'),
  });

  return {
    session: buildSession(instance, {
      subject,
      email,
      displayName,
      avatarUrl:
        getString(user ?? {}, 'profile_picture_url', 'profilePictureUrl') ??
        getString(payload, 'avatar_url', 'avatarUrl'),
      expiresAt: readTokenExpiry(accessToken),
    }),
    accessToken,
    refreshToken: getString(payload, 'refresh_token', 'refreshToken'),
  };
}
