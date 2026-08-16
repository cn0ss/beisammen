import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';

import { Button, Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { InviteComposer, type InviteComposerSubmitArgs } from '@/components/invites/InviteComposer';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { useTheme } from '@/hooks/use-theme';

interface CreatedCircle {
  circleId: string;
  name: string;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { pendingInviteToken, setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 1 },
  );
  const createCircle = useMutation(api.circles.create);
  const createInvite = useMutation(api.invites.create);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createdCircle, setCreatedCircle] = useState<CreatedCircle | null>(null);
  const [isCreatingCircle, setIsCreatingCircle] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const hasExistingCircle = circlesPage.results.length > 0;
  const isLoading = hasViewer && circlesPage.status === 'LoadingFirstPage';

  const handleCreateCircle = useCallback(async () => {
    const normalizedName = name.trim();

    if (!normalizedName) {
      setFeedback('Gib deinem Circle einen Namen.');
      return;
    }

    setIsCreatingCircle(true);
    setFeedback(null);

    try {
      const created = await createCircle({
        name: normalizedName,
        description: description.trim() || undefined,
      });
      const nextCircle = {
        circleId: created.circleId,
        name: normalizedName,
      };

      setCreatedCircle(nextCircle);
      setActiveCircleId(created.circleId);
      setFeedback('Circle erstellt.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Circle konnte nicht erstellt werden.');
    } finally {
      setIsCreatingCircle(false);
    }
  }, [createCircle, description, name, setActiveCircleId]);

  const handleCreateInvite = useCallback(
    async (args: InviteComposerSubmitArgs) => {
      if (!createdCircle) {
        throw new Error('Erstelle zuerst einen Circle.');
      }

      return await createInvite({
        circleId: createdCircle.circleId,
        mode: args.mode,
        invitedEmail: args.invitedEmail,
        role: args.role,
      });
    },
    [createInvite, createdCircle],
  );

  if (pendingInviteToken) {
    return <Redirect href="/(app)/invite" />;
  }

  if (!hasViewer || isLoading) {
    return <LoadingBox />;
  }

  if (hasExistingCircle && !createdCircle) {
    return <Redirect href="/(app)/home" />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: theme.primaryMuted }]}>
            <Ionicons name="people-circle-outline" size={28} color={theme.primary} />
          </View>
          <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>Willkommen</Text>
          <Text style={[styles.title, { color: theme.text }]}>Dein erster Circle</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Starte mit einer festen Gruppe und teile danach Fotos oder Videos nur mit diesen Menschen.
          </Text>
        </View>

        <Card>
          <View style={styles.stepHeader}>
            <Text style={[styles.stepNumber, { color: theme.primary }]}>01</Text>
            <View style={styles.stepCopy}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Circle benennen</Text>
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                Der Name sollte die Gruppe klar wiedererkennen lassen.
              </Text>
            </View>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Familie, Urlaub, Partner"
            placeholderTextColor={theme.textTertiary}
            editable={!createdCircle && !isCreatingCircle}
            style={[
              styles.input,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Beschreibung (optional)"
            placeholderTextColor={theme.textTertiary}
            editable={!createdCircle && !isCreatingCircle}
            style={[
              styles.input,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
          />
          <Button
            label={createdCircle ? 'Circle erstellt' : isCreatingCircle ? 'Erstellt...' : 'Circle erstellen'}
            icon={createdCircle ? 'checkmark-circle-outline' : 'add-outline'}
            loading={isCreatingCircle}
            disabled={Boolean(createdCircle) || !name.trim()}
            onPress={() => {
              void handleCreateCircle();
            }}
          />
        </Card>

        {createdCircle ? (
          <>
            <Card>
              <View style={styles.stepHeader}>
                <Text style={[styles.stepNumber, { color: theme.primary }]}>02</Text>
                <View style={styles.stepCopy}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Menschen einladen</Text>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    E-Mail bleibt privat voreingestellt. Offene Links sind für schnelle Übergaben gedacht.
                  </Text>
                </View>
              </View>
              <InviteComposer
                circleName={createdCircle.name}
                onCreateInvite={handleCreateInvite}
                onFeedback={setFeedback}
              />
            </Card>

            <Card>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Bereit zum Teilen</Text>
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                Dein Circle ist aktiv. Auf Home kannst du den ersten Beitrag vorbereiten.
              </Text>
              <Button
                label="Zu Home"
                icon="home-outline"
                onPress={() => {
                  router.replace('/(app)/home');
                }}
              />
            </Card>
          </>
        ) : null}
      </ScrollView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  stepNumber: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.sm,
    fontWeight: '800',
    marginTop: 4,
  },
  stepCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
});
