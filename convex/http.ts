import { httpRouter } from 'convex/server';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import {
  authenticateWorkOSCode,
  getWorkOSClientId,
  refreshWorkOSSession,
} from './lib/workos';
import { isValidEmailAddress, normalizeEmailAddress } from './waitlist';

const http = httpRouter();

export const httpSurface = [
  'auth.signIn',
  'auth.callback',
  'auth.nativeAuthenticate',
  'auth.refresh',
  'healthz',
  'waitlist.join',
] as const;

const WORKOS_API_BASE_URL = 'https://api.workos.com';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function readBaseUrl(): string {
  const configured =
    process.env.INSTANCE_BASE_URL ??
    process.env.CONVEX_SITE_URL ??
    process.env.CONVEX_SITE_ORIGIN ??
    'http://127.0.0.1:3211';

  return trimTrailingSlashes(configured);
}

function buildCallbackUrl(): string {
  return `${readBaseUrl()}/auth/callback`;
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function createPublicJsonResponse(body: unknown, init?: ResponseInit): Response {
  return createJsonResponse(body, {
    ...init,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...(init?.headers ?? {}),
    },
  });
}

function createPublicResponse(init?: ResponseInit): Response {
  return new Response(null, {
    ...init,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...(init?.headers ?? {}),
    },
  });
}

function appendParamsToUrl(baseUrl: string, params: Record<string, string>): string {
  const target = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }

  return target.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return undefined;
}

function getRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const candidate = value[key];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  return candidate as Record<string, unknown>;
}

async function readWaitlistPayload(
  request: Request,
): Promise<{
  email: string | null;
  locale: 'en' | 'de' | null;
  source: 'landing' | null;
}> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body: unknown = await request.json().catch(() => null);

    if (!isRecord(body)) {
      return {
        email: null,
        locale: null,
        source: null,
      };
    }

    return {
      email: typeof body.email === 'string' ? body.email : null,
      locale: body.locale === 'en' || body.locale === 'de' ? body.locale : null,
      source: body.source === 'landing' ? body.source : null,
    };
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return {
      email: null,
      locale: null,
      source: null,
    };
  }

  const email = formData.get('email');
  const locale = formData.get('locale');
  const source = formData.get('source');

  return {
    email: typeof email === 'string' ? email : null,
    locale: locale === 'en' || locale === 'de' ? locale : null,
    source: source === 'landing' ? source : null,
  };
}

http.route({
  path: '/healthz',
  method: 'GET',
  handler: httpAction(async () => {
    return Response.json({
      ok: true,
      service: 'beisammen-convex',
      deployment: process.env.CONVEX_DEPLOYMENT ?? null,
    });
  }),
});

http.route({
  path: '/waitlist/join',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return createPublicResponse({ status: 204 });
  }),
});

http.route({
  path: '/waitlist/join',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const payload = await readWaitlistPayload(request);
    const email = payload.email;
    const normalizedEmail =
      typeof email === 'string'
        ? normalizeEmailAddress(email)
        : null;

    if (!email || !normalizedEmail || !isValidEmailAddress(normalizedEmail)) {
      return createPublicJsonResponse(
        { ok: false, error: 'A valid email address is required.' },
        { status: 400 },
      );
    }

    if (!payload.locale || !payload.source) {
      return createPublicJsonResponse(
        { ok: false, error: 'locale and source are required.' },
        { status: 400 },
      );
    }

    const result: { alreadyJoined: boolean } = await ctx.runMutation(
      internal.waitlist.upsertEntry,
      {
        email,
        locale: payload.locale,
        source: payload.source,
        ...(request.headers.get('referer')
          ? { referrer: request.headers.get('referer') as string }
          : {}),
        ...(request.headers.get('user-agent')
          ? { userAgent: request.headers.get('user-agent') as string }
          : {}),
      },
    );

    return createPublicJsonResponse({
      ok: true,
      alreadyJoined: result.alreadyJoined,
    });
  }),
});

http.route({
  path: '/auth/sign-in',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const appRedirectUri = url.searchParams.get('app_redirect_uri');
    const state = url.searchParams.get('state') ?? '';

    if (!appRedirectUri) {
      return createJsonResponse(
        { error: 'app_redirect_uri is required.' },
        { status: 400 },
      );
    }

    const authorizeUrl = new URL(`${WORKOS_API_BASE_URL}/user_management/authorize`);
    authorizeUrl.searchParams.set('provider', 'authkit');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', getWorkOSClientId());
    authorizeUrl.searchParams.set('redirect_uri', buildCallbackUrl());
    authorizeUrl.searchParams.set('screen_hint', 'sign-in');
    authorizeUrl.searchParams.set(
      'state',
      JSON.stringify({
        appRedirectUri,
        appState: state,
      }),
    );

    return Response.redirect(authorizeUrl.toString(), 302);
  }),
});

http.route({
  path: '/auth/callback',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');

    if (!stateParam) {
      return createJsonResponse({ error: 'state is required.' }, { status: 400 });
    }

    let state: { appRedirectUri: string; appState?: string };

    try {
      state = JSON.parse(stateParam) as { appRedirectUri: string; appState?: string };
    } catch {
      return createJsonResponse({ error: 'state is invalid.' }, { status: 400 });
    }

    if (!code) {
      return Response.redirect(
        appendParamsToUrl(state.appRedirectUri, {
          error: 'missing_code',
          state: state.appState ?? '',
        }),
        302,
      );
    }

    try {
      const response = await authenticateWorkOSCode({
        code,
        request,
      });
      const responseRecord = response as unknown as Record<string, unknown>;
      const user = getRecord(responseRecord, 'user');

      const redirectTarget = appendParamsToUrl(state.appRedirectUri, {
        state: state.appState ?? '',
        access_token: getString(responseRecord, 'access_token', 'accessToken') ?? '',
        refresh_token: getString(responseRecord, 'refresh_token', 'refreshToken') ?? '',
        user_id: getString(user ?? {}, 'id') ?? '',
        email: getString(user ?? {}, 'email') ?? '',
        first_name: getString(user ?? {}, 'first_name', 'firstName') ?? '',
        last_name: getString(user ?? {}, 'last_name', 'lastName') ?? '',
        display_name:
          [getString(user ?? {}, 'first_name', 'firstName'), getString(user ?? {}, 'last_name', 'lastName')]
            .filter(Boolean)
            .join(' ')
            .trim() || getString(user ?? {}, 'email') || '',
        avatar_url: getString(user ?? {}, 'profile_picture_url', 'profilePictureUrl') ?? '',
      });

      return Response.redirect(redirectTarget, 302);
    } catch (error) {
      return Response.redirect(
        appendParamsToUrl(state.appRedirectUri, {
          error: 'authentication_failed',
          error_description:
            error instanceof Error ? error.message : 'Authentication failed.',
          state: state.appState ?? '',
        }),
        302,
      );
    }
  }),
});

http.route({
  path: '/auth/native/authenticate',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    try {
      const body: unknown = await request.json().catch(() => null);

      if (!isRecord(body)) {
        return createJsonResponse(
          { error: 'Request body must be a JSON object.' },
          { status: 400 },
        );
      }

      const code = typeof body.code === 'string' ? body.code : null;
      const codeVerifier =
        typeof body.codeVerifier === 'string' ? body.codeVerifier : null;

      if (!code || !codeVerifier) {
        return createJsonResponse(
          { error: 'code and codeVerifier are required.' },
          { status: 400 },
        );
      }

      const response = await authenticateWorkOSCode({
        code,
        codeVerifier,
        request,
      });
      const responseRecord = response as unknown as Record<string, unknown>;
      const user = getRecord(responseRecord, 'user');

      return createJsonResponse({
        accessToken: getString(responseRecord, 'access_token', 'accessToken'),
        refreshToken: getString(responseRecord, 'refresh_token', 'refreshToken'),
        subject:
          getString(user ?? {}, 'id') ??
          getString(responseRecord, 'user_id', 'userId', 'subject'),
        email: getString(user ?? {}, 'email'),
        firstName: getString(user ?? {}, 'first_name', 'firstName'),
        lastName: getString(user ?? {}, 'last_name', 'lastName'),
        displayName:
          [getString(user ?? {}, 'first_name', 'firstName'), getString(user ?? {}, 'last_name', 'lastName')]
            .filter(Boolean)
            .join(' ')
            .trim() || getString(user ?? {}, 'email'),
        avatarUrl: getString(user ?? {}, 'profile_picture_url', 'profilePictureUrl'),
      });
    } catch (error) {
      return createJsonResponse(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Authentication failed.',
        },
        { status: 500 },
      );
    }
  }),
});

http.route({
  path: '/auth/refresh',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    try {
      const body = (await request.json()) as { refreshToken?: string };

      if (!body?.refreshToken) {
        return createJsonResponse(
          { error: 'refreshToken is required.' },
          { status: 400 },
        );
      }

      const response = await refreshWorkOSSession({
        refreshToken: body.refreshToken,
        request,
      });
      const responseRecord = response as unknown as Record<string, unknown>;
      const user = getRecord(responseRecord, 'user');

      return createJsonResponse({
        accessToken: getString(responseRecord, 'access_token', 'accessToken'),
        refreshToken: getString(responseRecord, 'refresh_token', 'refreshToken'),
        subject:
          getString(user ?? {}, 'id') ??
          getString(responseRecord, 'user_id', 'userId', 'subject'),
        email: getString(user ?? {}, 'email'),
        displayName:
          [getString(user ?? {}, 'first_name', 'firstName'), getString(user ?? {}, 'last_name', 'lastName')]
            .filter(Boolean)
            .join(' ')
            .trim() || getString(user ?? {}, 'email'),
        avatarUrl: getString(user ?? {}, 'profile_picture_url', 'profilePictureUrl'),
      });
    } catch (error) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : 'Refresh failed.',
        },
        { status: 500 },
      );
    }
  }),
});

export default http;
