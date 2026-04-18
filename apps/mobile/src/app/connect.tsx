import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeBaseUrl } from '@beisammen/contracts';

import { Button, Card } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { useTheme } from '@/hooks/use-theme';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConnectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { instance, isReady, session, setPendingInviteToken } = useSession();
  const params = useLocalSearchParams<{ invite?: string | string[]; instance?: string | string[] }>();
  const inviteToken = firstParam(params.invite)?.trim() ?? '';
  const targetInstance = firstParam(params.instance)?.trim() ?? '';
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    async function handleLink() {
      if (!inviteToken) {
        setError('Dieser Link enthält keinen Invite-Token.');
        setIsProcessing(false);
        return;
      }

      if (
        targetInstance &&
        normalizeBaseUrl(targetInstance) !== normalizeBaseUrl(instance.instance.baseUrl)
      ) {
        setError('Dieser Invite verweist auf eine andere Instanz als die aktuell konfigurierte App.');
        setIsProcessing(false);
        return;
      }

      await setPendingInviteToken(inviteToken);
      router.replace(session ? '/(app)/invite' : '/(auth)/sign-in');
    }

    void handleLink();
  }, [instance.instance.baseUrl, inviteToken, isReady, router, session, setPendingInviteToken, targetInstance]);

  if (!isReady) {
    return null;
  }

  if (!error && !isProcessing) {
    return <Redirect href={session ? '/(app)/invite' : '/(auth)/sign-in'} />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        {error ? (
          <Card>
            <Text style={[styles.title, { color: theme.text }]}>Invite-Link konnte nicht geöffnet werden.</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{error}</Text>
            <Button
              label={session ? 'Zur App' : 'Zur Anmeldung'}
              icon={session ? 'arrow-forward-outline' : 'log-in-outline'}
              onPress={() => {
                router.replace(session ? '/(app)/home' : '/(auth)/sign-in');
              }}
            />
          </Card>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.primary} />
            <Text style={[styles.body, { color: theme.textSecondary }]}>Invite wird vorbereitet...</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  loading: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
});
