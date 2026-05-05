import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeBaseUrl } from '@beisammen/contracts';

import { Button, Card } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { resolveInstanceConfig } from '@/features/instances/discovery';
import { useTheme } from '@/hooks/use-theme';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConnectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { instance, isReady, session, setActiveInstance, setPendingInviteToken } = useSession();
  const params = useLocalSearchParams<{
    invite?: string | string[];
    instance?: string | string[];
  }>();
  const inviteToken = firstParam(params.invite)?.trim() ?? '';
  const targetInstance = firstParam(params.instance)?.trim() ?? '';
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [statusText, setStatusText] = useState('Verbindung wird vorbereitet...');

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const controller = new AbortController();

    async function handleLink() {
      const hasInviteToken = inviteToken.length > 0;
      const hasTargetInstance = targetInstance.length > 0;

      setError(null);
      setIsProcessing(true);
      setStatusText('Verbindung wird vorbereitet...');

      if (!hasInviteToken && !hasTargetInstance) {
        setError('Dieser Link enthält weder eine Instanz noch einen Invite-Token.');
        setIsProcessing(false);
        return;
      }

      if (
        hasTargetInstance &&
        normalizeBaseUrl(targetInstance) !== normalizeBaseUrl(instance.instance.baseUrl)
      ) {
        setStatusText('Instanz wird geprüft...');
        const nextInstance = await resolveInstanceConfig(targetInstance, {
          signal: controller.signal,
        });

        setStatusText('Instanz wird gewechselt...');
        await setActiveInstance(
          nextInstance,
          hasInviteToken ? { pendingInviteToken: inviteToken } : undefined,
        );

        if (!controller.signal.aborted) {
          router.replace('/');
        }

        return;
      }

      if (hasInviteToken) {
        await setPendingInviteToken(inviteToken);
      }

      if (!controller.signal.aborted) {
        router.replace(
          session ? (hasInviteToken ? '/(app)/invite' : '/(app)/home') : '/(auth)/sign-in',
        );
      }
    }

    void handleLink().catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }

      setError(
        error instanceof Error
          ? error.message
          : 'Dieser Link konnte nicht verarbeitet werden.',
      );
      setIsProcessing(false);
    });
    return () => {
      controller.abort();
    };
  }, [
    instance.instance.baseUrl,
    inviteToken,
    isReady,
    router,
    session,
    setActiveInstance,
    setPendingInviteToken,
    targetInstance,
  ]);

  if (!isReady) {
    return null;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        {error ? (
          <Card>
            <Text style={[styles.title, { color: theme.text }]}>
              Invite-Link konnte nicht geöffnet werden.
            </Text>
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
            <Text style={[styles.body, { color: theme.textSecondary }]}>{statusText}</Text>
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
