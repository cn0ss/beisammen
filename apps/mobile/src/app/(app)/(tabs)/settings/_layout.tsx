import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function SettingsLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.background },
      }}
    />
  );
}
