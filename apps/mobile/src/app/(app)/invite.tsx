import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useConvexAuth, useMutation, useQuery } from 'convex/react';

import { Button, Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import {
  inviteModeLabel,
  inviteRoleLabel,
  resolveInvitePreviewState,
} from '@/features/invites/preview-state';
import { useTheme } from '@/hooks/use-theme';

function formatInviteExpiry(timestamp: number) {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export default function InviteAcceptScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { clearPendingInviteToken, pendingInviteToken, session, setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const preview = useQuery(
    api.invites.preview,
    pendingInviteToken && viewerState?.viewer ? { token: pendingInviteToken } : 'skip',
  );
  const acceptInvite = useMutation(api.invites.accept);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const viewer = viewerState?.viewer ?? null;
  const isViewerBootstrapping =
    Boolean(session && convexAuth.isAuthenticated) &&
    (viewerState === undefined || (viewerState.isAuthenticated && viewerState.viewer === null));
  const previewState = resolveInvitePreviewState({ preview });

  const handleDismiss = useCallback(async () => {
    await clearPendingInviteToken();
    router.replace('/(app)/home');
  }, [clearPendingInviteToken, router]);

  const handleAccept = useCallback(async () => {
    if (!pendingInviteToken) {
      return;
    }

    setIsAccepting(true);
    setFeedback(null);

    try {
      const accepted = await acceptInvite({ token: pendingInviteToken });
      await clearPendingInviteToken();
      setActiveCircleId(accepted.circleId);
      router.replace('/(app)/home');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Einladung konnte nicht angenommen werden.');
    } finally {
      setIsAccepting(false);
    }
  }, [acceptInvite, clearPendingInviteToken, pendingInviteToken, router, setActiveCircleId]);

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!pendingInviteToken) {
    return <Redirect href="/(app)/home" />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Zurück"
            onPress={() => {
              void handleDismiss();
            }}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: theme.surface,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-back-outline" size={18} color={theme.text} />
          </Pressable>
          <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>invite</Text>
          <Text style={[styles.title, { color: theme.text }]}>Circle-Einladung</Text>
        </View>

        {isViewerBootstrapping || previewState.kind === 'loading' ? (
          <Card>
            <LoadingBox />
          </Card>
        ) : previewState.kind === 'not-found' || !preview ? (
          <Card>
            <Text style={[styles.cardTitle, { color: theme.text }]}>{previewState.title}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Der Invite-Link ist ungültig oder gehört nicht mehr zu einem bestehenden Circle.
            </Text>
            <Button label="Schließen" icon="close-outline" onPress={() => void handleDismiss()} />
          </Card>
        ) : (
          <>
            <Card>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{preview.circleName}</Text>
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                {preview.mode === 'open'
                  ? 'Dieser offene Link kann einmalig von einem neuen Mitglied angenommen werden.'
                  : 'Diese Einladung ist persönlich an die angegebene E-Mail gebunden.'}
              </Text>
              <InfoRow
                icon={preview.mode === 'open' ? 'link-outline' : 'mail-outline'}
                label="Typ"
                value={inviteModeLabel(preview.mode)}
              />
              {preview.invitedEmail ? (
                <InfoRow icon="mail-outline" label="Eingeladen" value={preview.invitedEmail} />
              ) : null}
              <InfoRow
                icon="mail-outline"
                label="Aktives Konto"
                value={viewer?.email ?? 'Keine E-Mail im Profil'}
              />
              <InfoRow icon="person-outline" label="Rolle" value={inviteRoleLabel(preview.role)} />
              <InfoRow
                icon="time-outline"
                label="Gültig bis"
                value={formatInviteExpiry(preview.expiresAt)}
              />
              {preview.acceptedBy ? (
                <InfoRow
                  icon="checkmark-circle-outline"
                  label="Angenommen"
                  value={preview.acceptedBy.displayName}
                />
              ) : null}
            </Card>

            {previewState.kind === 'can-accept' ? (
              <Card>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{previewState.title}</Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Wenn du fortfährst, wirst du sofort zu diesem Circle hinzugefügt.
                </Text>
                <Button
                  label="Einladung annehmen"
                  icon="checkmark-outline"
                  loading={isAccepting}
                  onPress={() => {
                    void handleAccept();
                  }}
                />
                <Button
                  label="Später"
                  icon="close-outline"
                  variant="outline"
                  disabled={isAccepting}
                  onPress={() => {
                    void handleDismiss();
                  }}
                />
              </Card>
            ) : (
              <Card>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{previewState.title}</Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  {previewState.kind === 'email-mismatch' && preview.invitedEmail
                    ? `Melde dich mit ${preview.invitedEmail} an, um diesen Invite anzunehmen.`
                    : previewState.kind === 'already-member'
                      ? 'Du bist bereits Mitglied in diesem Circle.'
                      : previewState.kind === 'consumed'
                        ? 'Dieser Einmal-Link kann nicht erneut verwendet werden.'
                        : 'Dieser Invite kann nicht mehr angenommen werden.'}
                </Text>
                <Button label="Zurück zur App" icon="arrow-back-outline" onPress={() => void handleDismiss()} />
              </Card>
            )}
          </>
        )}
      </ScrollView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={15} color={theme.textTertiary} />
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    letterSpacing: -0.6,
  },
  cardTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  infoLabel: {
    minWidth: 88,
    fontSize: FontSize.sm,
  },
  infoValue: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
});
