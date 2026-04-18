import { useEffect, useMemo, useRef, type PropsWithChildren } from 'react';

import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react';

import { api } from '@/features/convex/api';
import { useConvexSessionAuth, useSession } from '@/features/auth/session-provider';

function ViewerBootstrap() {
  const { session } = useSession();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer ?? null;
  const upsertViewer = useMutation(api.users.upsertFromIdentity);
  const upsertAttemptKey = useRef<string | null>(null);

  useEffect(() => {
    if (!session || !convexAuth.isAuthenticated) {
      upsertAttemptKey.current = null;
      return;
    }

    if (viewerState === undefined || !viewerState.isAuthenticated) {
      return;
    }

    const needsSync =
      !viewer ||
      (Boolean(session.email) && viewer.email !== session.email) ||
      (Boolean(session.displayName) && viewer.displayName !== session.displayName) ||
      (Boolean(session.avatarUrl) && viewer.avatarUrl !== session.avatarUrl);

    if (!needsSync) {
      return;
    }

    const attemptKey = [
      session.subject,
      session.email ?? '',
      session.displayName ?? '',
      session.avatarUrl ?? '',
    ].join('|');

    if (upsertAttemptKey.current === attemptKey) {
      return;
    }

    upsertAttemptKey.current = attemptKey;
    void upsertViewer({
      email: session.email,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
    }).catch(() => {
      upsertAttemptKey.current = null;
    });
  }, [convexAuth.isAuthenticated, session, upsertViewer, viewer, viewerState]);

  return null;
}

export function ConvexAppProvider({ children }: PropsWithChildren) {
  const { instance } = useSession();

  const client = useMemo(
    () => new ConvexReactClient(instance.backend.convexUrl),
    [instance.backend.convexUrl],
  );

  return (
    <ConvexProviderWithAuth client={client} useAuth={useConvexSessionAuth}>
      <ViewerBootstrap />
      {children}
    </ConvexProviderWithAuth>
  );
}
