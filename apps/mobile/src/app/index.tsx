import { useConvexAuth } from 'convex/react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';
import { useTheme } from '@/hooks/use-theme';

export default function IndexScreen() {
  const { isReady, pendingInviteToken, session } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();

  if (!isReady || (session && (convexAuth.isLoading || !convexAuth.isAuthenticated))) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (session) {
    return <Redirect href={pendingInviteToken ? '/invite' : '/home'} />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
