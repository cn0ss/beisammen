import { useConvexAuth } from 'convex/react';
import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { usePushNotifications } from '@/features/notifications/use-push-notifications';
import { useTheme } from '@/hooks/use-theme';

export default function AppLayout() {
  const { isReady, session } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  usePushNotifications();

  if (!isReady || (session && (convexAuth.isLoading || !convexAuth.isAuthenticated))) {
    return null;
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Detail screens live on this stack (not as hidden tabs) so iOS swipe-back
  // works everywhere without visible back buttons.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="circle/[circleId]" />
      <Stack.Screen name="circle/new" />
      <Stack.Screen name="invite" />
      <Stack.Screen name="share/[shareId]" />
      <Stack.Screen name="memories/viewer" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
