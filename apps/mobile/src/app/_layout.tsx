import 'expo-dev-client';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { SessionProvider } from '@/features/auth/session-provider';
import { ConvexAppProvider } from '@/features/convex/provider';
import { createLogger } from '@/lib/logger';

const logger = createLogger('navigation.root');

const lightNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.surface,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: Colors.light.primary,
  },
};

const darkNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.background,
    card: Colors.dark.surface,
    text: Colors.dark.text,
    border: Colors.dark.border,
    primary: Colors.dark.primary,
  },
};

function NavigationLogger() {
  const pathname = usePathname();
  const segments = useSegments();

  useEffect(() => {
    logger.debug('Route changed', {
      pathname,
      segments,
    });
  }, [pathname, segments]);

  return null;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  useEffect(() => {
    logger.info('Root layout mounted', {
      colorScheme: scheme ?? 'unknown',
      isDark,
    });
  }, [isDark, scheme]);

  return (
    <ThemeProvider value={isDark ? darkNavTheme : lightNavTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SessionProvider>
        <ConvexAppProvider>
          <NavigationLogger />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </ConvexAppProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
