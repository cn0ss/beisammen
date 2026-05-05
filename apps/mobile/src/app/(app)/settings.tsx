import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAction, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';

import type { BillingStatus, ConnectionCheck } from '@beisammen/contracts';

import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import type { CircleListItem } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { optimizePickerAsset, uploadPreparedFile } from '@/features/media/client';
import { useProfileImageUrl } from '@/features/media/use-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

import { Button, FeedbackToast, SectionHeader } from '@/components/ui';
import { CreateCircleCard } from '@/components/home/CreateCircleCard';
import { AccountCard } from '@/components/settings/AccountCard';
import { BillingCard } from '@/components/settings/BillingCard';
import { CirclesList } from '@/components/settings/CirclesList';
import { settingsCopy } from '@/components/settings/copy';
import { StorageUsageCard } from '@/components/settings/StorageUsageCard';

function useFadeIn(delay: number) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [delay, opacity, translateY]);

  return { opacity, transform: [{ translateY }] };
}

async function pickSingleImageAsset() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error('Ohne Mediathek-Zugriff kann kein Bild ausgewählt werden.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });

  if (result.canceled || !result.assets.length) {
    return null;
  }

  return result.assets[0] ?? null;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { instance, refreshSession, session, setActiveCircleId, signOut } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer ?? null;
  const hasViewer = viewerState?.isAuthenticated === true && viewer !== null;
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 20 },
  );
  const circles = hasViewer ? circlesPage.results : undefined;
  const storageStats = useQuery(api.storageStats.forViewer, hasViewer ? {} : 'skip');
  const createCircle = useMutation(api.circles.create);
  const checkStorageConnection = useAction(api.storageStats.checkConnection);
  const loadBillingStatus = useAction(api.billing.status);
  const createBillingCheckout = useAction(api.billing.createCheckout);
  const createBillingPortalSession = useAction(api.billing.createPortalSession);
  const createProfileImageTarget = useAction(api.users.createProfileImageTarget);
  const completeProfileImageUpload = useAction(api.users.completeProfileImageUpload);
  const removeProfileImage = useAction(api.users.removeProfileImage);
  const createCircleImageTarget = useAction(api.circles.createImageTarget);
  const completeCircleImageUpload = useAction(api.circles.completeImageUpload);
  const removeCircleImage = useAction(api.circles.removeImage);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck | null>(null);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | undefined>();
  const [isBillingBusy, setIsBillingBusy] = useState(false);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const [isProfileImageBusy, setIsProfileImageBusy] = useState(false);
  const [busyCircleId, setBusyCircleId] = useState<string | null>(null);

  const customProfileImageUrl = useProfileImageUrl(Boolean(viewer?.hasProfileImage));
  const profileImageUrl = customProfileImageUrl ?? session?.avatarUrl ?? null;

  const titleAnim = useFadeIn(50);
  const circlesAnim = useFadeIn(150);
  const createAnim = useFadeIn(250);
  const storageAnim = useFadeIn(350);
  const billingAnim = useFadeIn(450);
  const accountAnim = useFadeIn(550);

  const refreshBillingStatus = useCallback(async () => {
    if (!hasViewer) {
      setBillingStatus(undefined);
      return;
    }

    try {
      setBillingStatus(await loadBillingStatus({}));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Abrechnung konnte nicht geladen werden.');
    }
  }, [hasViewer, loadBillingStatus]);

  useEffect(() => {
    void refreshBillingStatus();
  }, [refreshBillingStatus]);

  const handleCreateCircle = useCallback(
    async (name: string, description: string) => {
      const created = await createCircle({
        name,
        description: description || undefined,
      });
      setActiveCircleId(created.circleId);
      setFeedback(`${settingsCopy.circleSingular} „${name}" wurde angelegt.`);
    },
    [createCircle, setActiveCircleId],
  );

  const handleOpenCircle = useCallback(
    (circle: CircleListItem) => {
      router.push(`/(app)/circle/${circle._id}` as never);
    },
    [router],
  );

  const handlePickProfileImage = useCallback(async () => {
    if (!viewer) {
      setFeedback('Dein Profil ist noch nicht geladen.');
      return;
    }

    setIsProfileImageBusy(true);
    setFeedback(null);

    try {
      const pickedAsset = await pickSingleImageAsset();

      if (!pickedAsset) {
        return;
      }

      const processedAsset = await optimizePickerAsset(pickedAsset);
      const prepared = await createProfileImageTarget({
        mimeType: processedAsset.mimeType,
        fileName: processedAsset.fileName,
      });
      const uploaded = await uploadPreparedFile({
        target: prepared.target,
        asset: processedAsset,
      });

      await completeProfileImageUpload({
        uploadId: prepared.uploadId,
        objectKey: uploaded.objectKey,
        storageId: uploaded.storageId,
        sizeBytes: processedAsset.sizeBytes,
      });
      setFeedback('Profilbild aktualisiert.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Profilbild konnte nicht gesetzt werden.');
    } finally {
      setIsProfileImageBusy(false);
    }
  }, [completeProfileImageUpload, createProfileImageTarget, viewer]);

  const handleRemoveProfileImage = useCallback(() => {
    if (!viewer?.hasProfileImage || isProfileImageBusy) {
      return;
    }

    Alert.alert('Profilbild entfernen?', 'Dein eigenes Profilbild wird entfernt.', [
      {
        text: 'Abbrechen',
        style: 'cancel',
      },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          setIsProfileImageBusy(true);
          setFeedback(null);
          void removeProfileImage({})
            .then(() => {
              setFeedback('Profilbild entfernt.');
            })
            .catch((error) => {
              setFeedback(
                error instanceof Error ? error.message : 'Profilbild konnte nicht entfernt werden.',
              );
            })
            .finally(() => {
              setIsProfileImageBusy(false);
            });
        },
      },
    ]);
  }, [isProfileImageBusy, removeProfileImage, viewer?.hasProfileImage]);

  const handlePickCircleImage = useCallback(
    async (circle: CircleListItem) => {
      if (!circle.canManage) {
        setFeedback('Du kannst dieses Circle-Bild nicht ändern.');
        return;
      }

      setBusyCircleId(circle._id);
      setFeedback(null);

      try {
        const pickedAsset = await pickSingleImageAsset();

        if (!pickedAsset) {
          return;
        }

        const processedAsset = await optimizePickerAsset(pickedAsset);
        const prepared = await createCircleImageTarget({
          circleId: circle._id,
          mimeType: processedAsset.mimeType,
          fileName: processedAsset.fileName,
        });
        const uploaded = await uploadPreparedFile({
          target: prepared.target,
          asset: processedAsset,
        });

        await completeCircleImageUpload({
          uploadId: prepared.uploadId,
          objectKey: uploaded.objectKey,
          storageId: uploaded.storageId,
          sizeBytes: processedAsset.sizeBytes,
        });
        setFeedback(`Bild für „${circle.name}" aktualisiert.`);
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : 'Circle-Bild konnte nicht gesetzt werden.',
        );
      } finally {
        setBusyCircleId(null);
      }
    },
    [completeCircleImageUpload, createCircleImageTarget],
  );

  const handleRemoveCircleImage = useCallback(
    (circle: CircleListItem) => {
      if (!circle.canManage || busyCircleId) {
        return;
      }

      Alert.alert(
        'Circle-Bild entfernen?',
        `Das Bild von „${circle.name}" wird entfernt.`,
        [
          {
            text: 'Abbrechen',
            style: 'cancel',
          },
          {
            text: 'Entfernen',
            style: 'destructive',
            onPress: () => {
              setBusyCircleId(circle._id);
              setFeedback(null);
              void removeCircleImage({ circleId: circle._id })
                .then(() => {
                  setFeedback(`Bild für „${circle.name}" entfernt.`);
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error ? error.message : 'Circle-Bild konnte nicht entfernt werden.',
                  );
                })
                .finally(() => {
                  setBusyCircleId(null);
                });
            },
          },
        ],
      );
    },
    [busyCircleId, removeCircleImage],
  );

  const handleRefresh = useCallback(() => {
    void refreshSession();
  }, [refreshSession]);

  const handleCheckStorageConnection = useCallback(async () => {
    setIsCheckingStorage(true);
    setFeedback(null);

    try {
      const result = await checkStorageConnection({});
      setConnectionCheck(result);
    } catch (error) {
      setConnectionCheck({
        ok: false,
        message: error instanceof Error ? error.message : 'Speicherprüfung fehlgeschlagen.',
      });
    } finally {
      setIsCheckingStorage(false);
    }
  }, [checkStorageConnection]);

  const handleManageBilling = useCallback(async () => {
    setIsBillingBusy(true);
    setFeedback(null);

    try {
      const result = await createBillingPortalSession({
        returnUrl: instance.instance.baseUrl,
      });

      if (!result.billingEnabled) {
        setFeedback('Self-hosted Instanzen haben keine Abrechnung.');
        return;
      }

      if (!result.portalUrl) {
        setFeedback('Für dieses Konto ist kein Portal verfügbar.');
        return;
      }

      await Linking.openURL(result.portalUrl);
      await refreshBillingStatus();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Abrechnung konnte nicht geöffnet werden.');
    } finally {
      setIsBillingBusy(false);
    }
  }, [createBillingPortalSession, instance.instance.baseUrl, refreshBillingStatus]);

  const handleChoosePlan = useCallback(
    async (planId: string) => {
      setIsBillingBusy(true);
      setFeedback(null);

      try {
        const result = await createBillingCheckout({
          planId,
          successUrl: instance.instance.baseUrl,
        });

        if (!result.billingEnabled) {
          setFeedback('Self-hosted Instanzen haben keine Tarife.');
          return;
        }

        if (result.checkoutUrl) {
          await Linking.openURL(result.checkoutUrl);
        } else {
          setFeedback('Tarif aktualisiert.');
        }

        await refreshBillingStatus();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : 'Tarif konnte nicht geöffnet werden.');
      } finally {
        setIsBillingBusy(false);
      }
    },
    [createBillingCheckout, instance.instance.baseUrl, refreshBillingStatus],
  );

  const handleSignOut = useCallback(() => {
    void signOut();
  }, [signOut]);

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  const accountLabel = session?.email ?? session?.displayName ?? 'Angemeldet';
  const profileName = viewer?.displayName ?? session?.displayName ?? accountLabel;
  const isLoadingMoreCircles = circlesPage.status === 'LoadingMore';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={titleAnim}>
          <Text style={[styles.title, { color: theme.text }]}>{settingsCopy.settingsTitle}</Text>
        </Animated.View>

        <Animated.View style={[circlesAnim, styles.section]}>
          <SectionHeader
            icon="people-outline"
            label={settingsCopy.yourCirclesLabel}
            count={circles?.length}
          />
          <CirclesList
            circles={circles}
            busyCircleId={busyCircleId}
            onOpenCircle={handleOpenCircle}
            onPickCircleImage={handlePickCircleImage}
            onRemoveCircleImage={handleRemoveCircleImage}
          />
          {circles && circlesPage.status !== 'Exhausted' ? (
            <Button
              label={isLoadingMoreCircles ? 'Lädt...' : 'Weitere Circles laden'}
              icon="chevron-down-outline"
              variant="outline"
              loading={isLoadingMoreCircles}
              disabled={isLoadingMoreCircles}
              onPress={() => circlesPage.loadMore(20)}
            />
          ) : null}
        </Animated.View>

        <Animated.View style={[createAnim, styles.section]}>
          <SectionHeader icon="add-circle-outline" label={settingsCopy.createCircleLabel} />
          <CreateCircleCard onCreateCircle={handleCreateCircle} />
        </Animated.View>

        <Animated.View style={[storageAnim, styles.section]}>
          <SectionHeader icon="cloud-outline" label="Speicher" />
          <StorageUsageCard
            stats={storageStats}
            connectionCheck={connectionCheck}
            isCheckingConnection={isCheckingStorage}
            onCheckConnection={handleCheckStorageConnection}
          />
        </Animated.View>

        <Animated.View style={[billingAnim, styles.section]}>
          <SectionHeader icon="card-outline" label="Tarif" />
          <BillingCard
            status={billingStatus}
            isBusy={isBillingBusy}
            onManageBilling={handleManageBilling}
            onChoosePlan={handleChoosePlan}
          />
        </Animated.View>

        <Animated.View style={[accountAnim, styles.section]}>
          <SectionHeader icon="person-outline" label="Konto" />
          <AccountCard
            serverName={instance.instance.name}
            serverUrl={instance.instance.baseUrl}
            accountLabel={accountLabel}
            profileName={profileName}
            profileImageUrl={profileImageUrl}
            hasProfileImage={Boolean(viewer?.hasProfileImage)}
            profileImageLoading={isProfileImageBusy}
            onPickProfileImage={handlePickProfileImage}
            onRemoveProfileImage={handleRemoveProfileImage}
            onRefresh={handleRefresh}
            onSignOut={handleSignOut}
          />
        </Animated.View>

        <Text style={[styles.footer, { color: theme.textTertiary }]}>
          beisammen · Deine Erinnerungen, dein Speicher
        </Text>
      </ScrollView>

      <FeedbackToast message={feedback} onDismiss={handleDismissFeedback} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  section: {
    gap: Spacing.sm,
  },
  footer: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: Spacing.sm,
  },
});
