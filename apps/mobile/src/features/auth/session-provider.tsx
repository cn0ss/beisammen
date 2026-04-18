import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { AppSession, InstanceConfig } from '@beisammen/contracts';

import { createAuthAdapter } from '@/features/auth/adapters';
import {
  clearStoredAuthState,
  clearStoredInviteToken,
  loadStoredAuthState,
  loadStoredInviteToken,
  saveStoredInviteToken,
  saveStoredAuthState,
} from '@/features/auth/session-store';
import { defaultInstanceConfig } from '@/features/instances/catalog';
import { createLogger } from '@/lib/logger';

WebBrowser.maybeCompleteAuthSession();

const logger = createLogger('auth.session');
const TOKEN_REFRESH_LEEWAY_MS = 60_000;

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

interface ConvexAuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
}

interface SessionContextValue {
  isBusy: boolean;
  isReady: boolean;
  session: AppSession | null;
  instance: InstanceConfig;
  instanceError: string | null;
  activeCircleId: string | null;
  pendingInviteToken: string | null;
  setActiveCircleId: (circleId: string | null) => void;
  setPendingInviteToken: (token: string) => Promise<void>;
  clearPendingInviteToken: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  convexAuth: ConvexAuthState;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function isTokenExpiringSoon(session: AppSession | null, leewayMs = TOKEN_REFRESH_LEEWAY_MS): boolean {
  if (!session?.expiresAt) {
    return false;
  }

  return session.expiresAt - Date.now() <= leewayMs;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [instance] = useState(defaultInstanceConfig);
  const [session, setSession] = useState<AppSession | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [pendingInviteToken, setPendingInviteTokenState] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const adapter = useMemo(() => createAuthAdapter(instance), [instance]);
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const restoredInstanceUrlRef = useRef<string | null>(null);

  const persistAuthState = useEffectEvent(async (
    nextSession: AppSession,
    nextTokens: AuthTokens | null,
  ) => {
    setSession(nextSession);
    setTokens(nextTokens);

    if (!nextTokens?.accessToken) {
      await clearStoredAuthState(instance.instance.baseUrl);
      return;
    }

    await saveStoredAuthState(instance.instance.baseUrl, {
      session: nextSession,
      accessToken: nextTokens.accessToken,
      refreshToken: nextTokens.refreshToken,
    });
  });

  const clearLocalSession = useEffectEvent(async (reason: string) => {
    logger.warn('Clearing local auth session', {
      reason,
      instanceUrl: instance.instance.baseUrl,
    });
    await clearStoredAuthState(instance.instance.baseUrl);
    setSession(null);
    setTokens(null);
    setActiveCircleId(null);
  });

  const setPendingInviteToken = useEffectEvent(async (token: string) => {
    const normalized = token.trim();

    if (!normalized) {
      return;
    }

    setPendingInviteTokenState(normalized);
    await saveStoredInviteToken(instance.instance.baseUrl, normalized);
  });

  const clearPendingInviteToken = useEffectEvent(async () => {
    setPendingInviteTokenState(null);
    await clearStoredInviteToken(instance.instance.baseUrl);
  });

  const refreshAccessToken = useEffectEvent(
    async (
      reason: string,
      input?: {
        session?: AppSession | null;
        refreshToken?: string;
      },
    ): Promise<string | null> => {
      const currentSession = input?.session ?? session;
      const refreshToken = input?.refreshToken ?? tokens?.refreshToken;

      if (!refreshToken) {
        logger.debug('Skipping refresh because no refresh token is available', { reason });
        return tokens?.accessToken ?? null;
      }

      if (refreshInFlightRef.current) {
        return await refreshInFlightRef.current;
      }

      const refreshPromise = (async () => {
        logger.info('Refreshing WorkOS session token', {
          reason,
          hasCurrentSession: Boolean(currentSession),
        });

        try {
          const next = await adapter.refreshSession({
            instance,
            currentSession,
            refreshToken,
          });

          if (!next?.accessToken) {
            throw new Error('Refresh response did not include an access token.');
          }

          const nextTokens: AuthTokens = {
            accessToken: next.accessToken,
            refreshToken: next.refreshToken ?? refreshToken,
          };

          await persistAuthState(next.session, nextTokens);
          setInstanceError(null);

          return nextTokens.accessToken;
        } catch (error) {
          logger.error('Failed to refresh WorkOS session token', {
            reason,
            error,
          });
          await clearLocalSession('refresh_failed');
          setInstanceError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
          return null;
        } finally {
          refreshInFlightRef.current = null;
        }
      })();

      refreshInFlightRef.current = refreshPromise;
      return await refreshPromise;
    },
  );

  const ensureFreshAccessToken = useEffectEvent(async (reason: string): Promise<string | null> => {
    if (!tokens?.accessToken) {
      return null;
    }

    if (!isTokenExpiringSoon(session)) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      if (session?.expiresAt && session.expiresAt <= Date.now()) {
        await clearLocalSession('expired_without_refresh_token');
        setInstanceError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
        return null;
      }

      return tokens.accessToken;
    }

    return await refreshAccessToken(reason);
  });

  useEffect(() => {
    const instanceUrl = instance.instance.baseUrl;

    if (restoredInstanceUrlRef.current === instanceUrl) {
      return;
    }

    restoredInstanceUrlRef.current = instanceUrl;
    let isCancelled = false;

    async function restore() {
      logger.info('Restoring auth session from storage', {
        instanceUrl,
        provider: instance.auth.provider,
        convexUrl: instance.backend.convexUrl,
      });

      try {
        const storedInvite = await loadStoredInviteToken(instanceUrl);

        if (!isCancelled) {
          setPendingInviteTokenState(storedInvite);
        }

        const stored = await loadStoredAuthState(instanceUrl);

        if (!stored || isCancelled) {
          return;
        }

        const restoredSession = await adapter.restoreSession({
          instance,
          currentSession: stored.session,
        });

        if (!restoredSession || isCancelled) {
          await clearStoredAuthState(instance.instance.baseUrl);
          return;
        }

        const restoredTokens: AuthTokens = {
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken,
        };

        setSession(restoredSession);
        setTokens(restoredTokens);

        if (stored.refreshToken) {
          const refreshedAccessToken = await refreshAccessToken('restore', {
            session: restoredSession,
            refreshToken: stored.refreshToken,
          });

          if (!refreshedAccessToken || isCancelled) {
            return;
          }
        } else {
          await persistAuthState(restoredSession, restoredTokens);
        }

        logger.info('Restored stored auth session', {
          subject: restoredSession.subject,
          hasRefreshToken: Boolean(stored.refreshToken),
        });
      } catch (error) {
        logger.error('Failed to restore stored auth session', { error });
        await clearStoredAuthState(instanceUrl);
      } finally {
        if (!isCancelled) {
          setIsReady(true);
        }
      }
    }

    void restore();

    return () => {
      isCancelled = true;
    };
  }, [adapter, instance]);

  useEffect(() => {
    if (!tokens?.refreshToken || !session?.expiresAt) {
      return;
    }

    const refreshDelay = Math.max(session.expiresAt - Date.now() - TOKEN_REFRESH_LEEWAY_MS, 0);
    const timeout = setTimeout(() => {
      void refreshAccessToken('scheduled');
    }, refreshDelay);

    return () => clearTimeout(timeout);
  }, [session?.expiresAt, tokens?.refreshToken]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (
        previousAppState.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        void ensureFreshAccessToken('resume');
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const refreshSession = useEffectEvent(async () => {
    const nextAccessToken = await refreshAccessToken('manual');

    if (!nextAccessToken) {
      throw new Error('Refresh response did not include an access token.');
    }
  });

  const signIn = useEffectEvent(async () => {
    const redirectPath =
      typeof instance.auth.publicConfig.redirectPath === 'string'
        ? instance.auth.publicConfig.redirectPath
        : 'auth/callback';

    setIsBusy(true);
    setInstanceError(null);

    try {
      const redirectUrl = Linking.createURL(redirectPath);
      const begin = await adapter.beginSignIn({
        instance,
        redirectUrl,
      });

      if (begin.type === 'session') {
        const nextTokens = begin.result.accessToken
          ? {
              accessToken: begin.result.accessToken,
              refreshToken: begin.result.refreshToken,
            }
          : null;

        await persistAuthState(begin.result.session, nextTokens);
        return;
      }

      logger.info('Opening browser auth session', {
        provider: instance.auth.provider,
        redirectUrl,
      });

      const result = await WebBrowser.openAuthSessionAsync(begin.authUrl, redirectUrl);

      if (result.type !== 'success') {
        logger.warn('Auth session did not complete successfully', {
          resultType: result.type,
        });
        return;
      }

      const next = await adapter.handleCallback({
        instance,
        callbackUrl: result.url,
        currentSession: session,
      });

      if (!next) {
        throw new Error('Auth callback did not return a valid session.');
      }

      const nextTokens = next.accessToken
        ? {
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
          }
        : null;

      await persistAuthState(next.session, nextTokens);
      logger.info('User session established', {
        subject: next.session.subject,
        provider: next.session.provider,
      });
    } catch (error) {
      logger.error('Sign-in failed', { error });
      setInstanceError(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setIsBusy(false);
    }
  });

  const signOut = useEffectEvent(async () => {
    logger.info('Signing out locally');
    await adapter.signOut({
      instance,
      currentSession: session,
    });
    await clearLocalSession('sign_out');
    setInstanceError(null);
  });

  // Keep a ref so the stable fetchAccessToken wrapper always sees latest state.
  const fetchConvexTokenRef = useRef<(args: { forceRefreshToken: boolean }) => Promise<string | null>>(
    async () => null,
  );
  fetchConvexTokenRef.current = async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (forceRefreshToken) {
      return await refreshAccessToken('convex', {
        session,
        refreshToken: tokens?.refreshToken,
      });
    }

    return await ensureFreshAccessToken('convex');
  };

  // Stable function reference — never changes identity across renders.
  const stableFetchAccessToken = useRef(
    async (args: { forceRefreshToken: boolean }) => fetchConvexTokenRef.current(args),
  ).current;

  // Only transition isAuthenticated when the token truly appears or disappears,
  // NOT on every refresh that swaps one valid JWT for another.
  const isAuthenticated = Boolean(tokens?.accessToken);

  const convexAuth = useMemo<ConvexAuthState>(
    () => ({
      isLoading: !isReady,
      isAuthenticated,
      fetchAccessToken: stableFetchAccessToken,
    }),
    [isReady, isAuthenticated, stableFetchAccessToken],
  );

  const value: SessionContextValue = {
    isBusy,
    isReady,
    session,
    instance,
    instanceError,
    activeCircleId,
    pendingInviteToken,
    setActiveCircleId,
    async setPendingInviteToken(token: string) {
      await setPendingInviteToken(token);
    },
    async clearPendingInviteToken() {
      await clearPendingInviteToken();
    },
    async signIn() {
      await signIn();
    },
    async signOut() {
      await signOut();
    },
    async refreshSession() {
      await refreshSession();
    },
    convexAuth,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within SessionProvider.');
  }

  return context;
}

export function useConvexSessionAuth(): ConvexAuthState {
  return useSession().convexAuth;
}
