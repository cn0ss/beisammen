import Ionicons from '@expo/vector-icons/Ionicons';
import { useConvexAuth, useQuery } from 'convex/react';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';

import { api } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { useTheme } from '@/hooks/use-theme';

export default function AppLayout() {
  const { isReady, session } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const activitySummary = useQuery(
    api.activity.summaryForViewer,
    session && convexAuth.isAuthenticated ? {} : 'skip',
  );
  const activityBadge = activitySummary?.hasUnread
    ? activitySummary.unreadCount >= 99
      ? '99+'
      : activitySummary.unreadCount
    : undefined;

  if (!isReady || (session && (convexAuth.isLoading || !convexAuth.isAuthenticated))) {
    return null;
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.tabBarBorder,
          borderTopWidth: 0.5,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.04,
              shadowRadius: 8,
            },
            android: {
              elevation: 8,
            },
          }),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.1,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Aktivität',
          tabBarBadge: activityBadge,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="share/[shareId]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="circle/[circleId]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="invite"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
