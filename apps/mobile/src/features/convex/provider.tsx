import { useAuth } from '@clerk/expo';
import { useEffect, useMemo, useRef, type PropsWithChildren } from 'react';

import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';

import { AppConfigGate } from '@/features/app-config/AppConfigGate';
import { api } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { logInPurchases } from '@/features/billing/purchases';

function ViewerBootstrap() {
  const { session, instance } = useSession();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer ?? null;
  const upsertViewer = useMutation(api.users.upsertFromIdentity);
  const upsertAttemptKey = useRef<string | null>(null);
  const purchasesLoginKey = useRef<string | null>(null);

  useEffect(() => {
    if (!session || !convexAuth.isAuthenticated) {
      upsertAttemptKey.current = null;
      return;
    }

    if (viewerState === undefined || !viewerState.isAuthenticated) {
      return;
    }

    if (viewer?.deletionRequestedAt !== undefined) {
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

  // Identify the RevenueCat customer as the Convex user id so purchases and
  // webhook events attach to the right billing owner.
  useEffect(() => {
    if (
      !viewer ||
      viewer.deletionRequestedAt !== undefined ||
      instance.deployment.kind !== 'cloud'
    ) {
      purchasesLoginKey.current = null;
      return;
    }

    if (purchasesLoginKey.current === viewer._id) {
      return;
    }

    purchasesLoginKey.current = viewer._id;
    void logInPurchases(viewer._id);
  }, [instance.deployment.kind, viewer]);

  return null;
}

export function ConvexAppProvider({ children }: PropsWithChildren) {
  const { instance } = useSession();

  const client = useMemo(
    () => new ConvexReactClient(instance.backend.convexUrl),
    [instance.backend.convexUrl],
  );

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      <ViewerBootstrap />
      <AppConfigGate>{children}</AppConfigGate>
    </ConvexProviderWithClerk>
  );
}
