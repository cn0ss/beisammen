import { httpRouter } from 'convex/server';
import { isRateLimitError } from '@convex-dev/rate-limiter';
import {
  BILLING_RETURN_PATH,
  INSTANCE_DISCOVERY_PATH,
  normalizeBillingReturnSource,
} from '@beisammen/contracts';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import {
  authenticateWorkOSCode,
  getWorkOSClientId,
  refreshWorkOSSession,
} from './lib/workos';
import {
  appendParamsToUrl,
  buildBillingReturnAppUrl,
  buildCallbackUrlFromEnv,
  buildPublicInstanceConfigFromEnv,
  isRecord,
  normalizeWorkOSHttpSessionPayload,
} from './lib/httpHelpers';
import { isValidEmailAddress, normalizeEmailAddress } from './waitlist';

const http = httpRouter();

export const httpSurface = [
  'auth.signIn',
  'auth.callback',
  'auth.nativeAuthenticate',
  'auth.refresh',
  'billing.return',
  'healthz',
  'instance.discovery',
  'publicShare.preview',
  'waitlist.join',
] as const;

const WORKOS_API_BASE_URL = 'https://api.workos.com';

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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...(init?.headers ?? {}),
    },
  });
}

function createRateLimitedResponse(retryAfterMs?: number): Response {
  const safeRetryAfterMs =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
      ? Math.max(0, Math.ceil(retryAfterMs))
      : 0;

  return createPublicJsonResponse(
    {
      ok: false,
      error: 'rate_limited',
      retryAfterMs: safeRetryAfterMs,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil(safeRetryAfterMs / 1000))),
      },
    },
  );
}

function readClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');

  if (forwardedFor) {
    const firstForwardedIp = forwardedFor
      .split(',')
      .map((value) => value.trim())
      .find(Boolean);

    if (firstForwardedIp) {
      return firstForwardedIp;
    }
  }

  const directIp =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip');

  if (!directIp) {
    return null;
  }

  const trimmedIp = directIp.trim();
  return trimmedIp.length > 0 ? trimmedIp : null;
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

async function readPublicSharePayload(
  request: Request,
): Promise<{
  token: string | null;
  cursor: string | null;
}> {
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    return {
      token: null,
      cursor: null,
    };
  }

  const body: unknown = await request.json().catch(() => null);

  if (!isRecord(body)) {
    return {
      token: null,
      cursor: null,
    };
  }

  return {
    token: typeof body.token === 'string' ? body.token : null,
    cursor: typeof body.cursor === 'string' || body.cursor === null ? body.cursor : null,
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
  path: BILLING_RETURN_PATH,
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const source = normalizeBillingReturnSource(url.searchParams.get('source'));

    return Response.redirect(buildBillingReturnAppUrl(process.env, source), 302);
  }),
});

http.route({
  path: INSTANCE_DISCOVERY_PATH,
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return createPublicResponse({ status: 204 });
  }),
});

http.route({
  path: INSTANCE_DISCOVERY_PATH,
  method: 'GET',
  handler: httpAction(async () => {
    return createPublicJsonResponse(buildPublicInstanceConfigFromEnv());
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
    const clientIp = readClientIp(request);
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

    try {
      const result: { alreadyJoined: boolean } = await ctx.runMutation(
        internal.waitlist.joinFromHttp,
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
          ...(clientIp
            ? { clientIp }
            : {}),
        },
      );

      return createPublicJsonResponse({
        ok: true,
        alreadyJoined: result.alreadyJoined,
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        return createRateLimitedResponse(error.data.retryAfter);
      }

      throw error;
    }
  }),
});

http.route({
  path: '/public/share/preview',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return createPublicResponse({ status: 204 });
  }),
});

http.route({
  path: '/public/share/preview',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const payload = await readPublicSharePayload(request);

    if (!payload.token?.trim()) {
      return createPublicJsonResponse(
        { ok: false, error: 'token_required' },
        { status: 400 },
      );
    }

    const result = await ctx.runAction(internal.publicLinks.resolvePublicCirclePayload, {
      token: payload.token,
      cursor: payload.cursor,
    });

    if (!result) {
      return createPublicJsonResponse(
        { ok: false, error: 'not_found' },
        { status: 404 },
      );
    }

    return createPublicJsonResponse({
      ok: true,
      ...result,
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
    authorizeUrl.searchParams.set('redirect_uri', buildCallbackUrlFromEnv());
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
      const normalized = normalizeWorkOSHttpSessionPayload(response);

      const redirectTarget = appendParamsToUrl(state.appRedirectUri, {
        state: state.appState ?? '',
        access_token: normalized.accessToken,
        refresh_token: normalized.refreshToken,
        user_id: normalized.subject,
        email: normalized.email,
        first_name: normalized.firstName,
        last_name: normalized.lastName,
        display_name: normalized.displayName,
        avatar_url: normalized.avatarUrl,
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
      const normalized = normalizeWorkOSHttpSessionPayload(response);

      return createJsonResponse({
        accessToken: normalized.accessToken,
        refreshToken: normalized.refreshToken,
        subject: normalized.subject,
        email: normalized.email,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        displayName: normalized.displayName,
        avatarUrl: normalized.avatarUrl,
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
      const normalized = normalizeWorkOSHttpSessionPayload(response);

      return createJsonResponse({
        accessToken: normalized.accessToken,
        refreshToken: normalized.refreshToken,
        subject: normalized.subject,
        email: normalized.email,
        displayName: normalized.displayName,
        avatarUrl: normalized.avatarUrl,
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
