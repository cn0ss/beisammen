import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';

import {
  enqueue,
  initialUploadQueueState,
  markUploadStatus,
  patchUploadQueueItem,
  removeUploadQueueItems,
  type UploadQueueState,
} from '@beisammen/upload-client';

import { BottomTabInset, Fonts, FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import {
  assetKind,
  fileNameFromPickerAsset,
  formatMediaLocation,
  mimeTypeForPickerAsset,
  optimizePickerAsset,
  resolvePickerAssetLocations,
  uploadPreparedFile,
} from '@/features/media/client';
import { useProfileImageUrl } from '@/features/media/use-profile-image-url';
import { useTheme } from '@/hooks/use-theme';

import { EmptyState, FeedbackToast, LoadingBox } from '@/components/ui';
import { CircleSelector } from '@/components/home/CircleSelector';
import { ComposeFab } from '@/components/home/ComposeFab';
import { DraftSheet } from '@/components/home/DraftSheet';
import { FeedCard } from '@/components/home/FeedCard';
import { HomeHeader } from '@/components/home/HomeHeader';
import { Ornament } from '@/components/home/Ornament';

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

export default function HomeScreen() {
  const router = useRouter();
  const { activeCircleId, session, setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const theme = useTheme();

  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const viewer = viewerState?.viewer;
  const hasViewer = viewerState?.isAuthenticated === true && viewer !== null;
  const circles = useQuery(api.circles.listForViewer, hasViewer ? {} : 'skip');
  const selectedCircle = circles?.find((circle) => circle._id === activeCircleId) ?? null;
  const shareFeed = useQuery(
    api.shares.listForCircle,
    hasViewer && activeCircleId ? { circleId: activeCircleId } : 'skip',
  );
  const activeDraft = useQuery(
    api.shares.getDraftForCircle,
    hasViewer && activeCircleId ? { circleId: activeCircleId } : 'skip',
  );
  const getOrCreateDraft = useMutation(api.shares.getOrCreateDraft);
  const updateDraft = useMutation(api.shares.updateDraft);
  const publishDraft = useMutation(api.shares.publish);
  const createTarget = useAction(api.uploads.createTarget);
  const completeUpload = useAction(api.uploads.complete);
  const discardUpload = useAction(api.uploads.discard);
  const deleteDraftAsset = useAction(api.assets.deleteDraftAsset);
  const deleteShare = useAction(api.shares.delete);

  const [draftCaption, setDraftCaption] = useState('');
  const [uploadQueue, setUploadQueue] = useState<UploadQueueState>(initialUploadQueueState);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingShareId, setDeletingShareId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isDraftSheetOpen, setIsDraftSheetOpen] = useState(false);
  const customProfileImageUrl = useProfileImageUrl(Boolean(viewer?.hasProfileImage));

  // ---------------------------------------------------------------------------
  //  Auto-select first circle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!circles || circles.length === 0) {
      if (activeCircleId) setActiveCircleId(null);
      return;
    }
    if (!activeCircleId || !circles.some((circle) => circle._id === activeCircleId)) {
      setActiveCircleId(circles[0]?._id ?? null);
    }
  }, [activeCircleId, circles, setActiveCircleId]);

  // ---------------------------------------------------------------------------
  //  Draft caption sync
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setDraftCaption(activeDraft?.caption ?? '');
  }, [activeDraft?._id, activeDraft?.caption]);

  useEffect(() => {
    if (!activeDraft) return;
    if (draftCaption === activeDraft.caption) return;

    const timeout = setTimeout(() => {
      void updateDraft({
        shareBatchId: activeDraft._id,
        caption: draftCaption.trim() || undefined,
      }).catch((error) => {
        setFeedback(error instanceof Error ? error.message : 'Entwurf konnte nicht aktualisiert werden.');
      });
    }, 400);

    return () => clearTimeout(timeout);
  }, [activeDraft, draftCaption, updateDraft]);

  // ---------------------------------------------------------------------------
  //  Animations
  // ---------------------------------------------------------------------------

  const headerAnim = useFadeIn(50);
  const circlesAnim = useFadeIn(120);
  const feedAnim = useFadeIn(200);

  // ---------------------------------------------------------------------------
  //  Derived state
  // ---------------------------------------------------------------------------

  const displayName = session?.displayName ?? session?.email ?? 'beisammen';
  const profileImageUrl = customProfileImageUrl ?? session?.avatarUrl ?? null;
  const hasCircles = Boolean(circles && circles.length > 0);
  const isViewerBootstrapping =
    Boolean(session) &&
    (
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated ||
      viewerState === undefined ||
      (viewerState.isAuthenticated && !viewer)
    );

  const selectedQueueItems = selectedCircle
    ? uploadQueue.items.filter((item) => item.circleId === selectedCircle._id)
    : [];
  const hasPendingUploads = selectedQueueItems.some(
    (item) => item.status === 'processing' || item.status === 'uploading',
  );
  const canPublish = Boolean(activeDraft && activeDraft.assets.length > 0 && !hasPendingUploads);
  const isDraftLoading = Boolean(activeCircleId) && activeDraft === undefined;

  // ---------------------------------------------------------------------------
  //  Handlers
  // ---------------------------------------------------------------------------

  const handleSelectCircle = useCallback(
    (circleId: string) => setActiveCircleId(circleId),
    [setActiveCircleId],
  );

  const performDeleteShare = useCallback(
    async (shareBatchId: string, successMessage: string) => {
      setDeletingShareId(shareBatchId);
      try {
        await deleteShare({ shareBatchId });
        setUploadQueue((state) =>
          removeUploadQueueItems(state, (item) => item.shareBatchId === shareBatchId),
        );
        if (activeDraft?._id === shareBatchId) {
          setDraftCaption('');
        }
        setFeedback(successMessage);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : 'Beitrag konnte nicht gelöscht werden.');
      } finally {
        setDeletingShareId(null);
      }
    },
    [activeDraft?._id, deleteShare],
  );

  const handleDeleteDraft = useCallback(() => {
    if (!activeDraft) return;
    Alert.alert(
      'Entwurf löschen?',
      'Der Entwurf und alle hochgeladenen Medien werden dauerhaft entfernt.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => {
            setIsDraftSheetOpen(false);
            void performDeleteShare(activeDraft._id, 'Entwurf wurde gelöscht.');
          },
        },
      ],
    );
  }, [activeDraft, performDeleteShare]);

  const handleDeletePublishedShare = useCallback(
    (shareBatchId: string) => {
      Alert.alert(
        'Beitrag löschen?',
        'Der Beitrag und alle Medien werden dauerhaft gelöscht.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Löschen',
            style: 'destructive',
            onPress: () => {
              void performDeleteShare(shareBatchId, 'Beitrag wurde gelöscht.');
            },
          },
        ],
      );
    },
    [performDeleteShare],
  );

  const handleDeleteAsset = useCallback(
    (assetId: string) => {
      Alert.alert(
        'Medium entfernen?',
        'Die Datei wird aus dem Entwurf und aus dem Storage gelöscht.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Entfernen',
            style: 'destructive',
            onPress: () => {
              void deleteDraftAsset({ assetId })
                .then(() => {
                  setFeedback('Medium wurde entfernt.');
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error ? error.message : 'Medium konnte nicht entfernt werden.',
                  );
                });
            },
          },
        ],
      );
    },
    [deleteDraftAsset],
  );

  const handleRemoveFailedUpload = useCallback(
    async (itemId: string) => {
      const queueItem = uploadQueue.items.find((item) => item.id === itemId);

      if (!queueItem) {
        return;
      }

      if (queueItem.uploadId) {
        try {
          await discardUpload({
            uploadId: queueItem.uploadId,
          });
        } catch (error) {
          setFeedback(
            error instanceof Error
              ? error.message
              : 'Fehlgeschlagener Upload konnte nicht entfernt werden.',
          );
          return;
        }
      }

      setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === itemId));
    },
    [discardUpload, uploadQueue.items],
  );

  const handlePickMedia = useCallback(async () => {
    if (!selectedCircle) {
      setFeedback('Bitte wähle zuerst einen Circle aus.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setFeedback('Ohne Mediathek-Zugriff können keine Fotos oder Videos ausgewählt werden.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      exif: true,
      quality: 1,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets.length) return;

    setFeedback(null);
    setIsUploading(true);

    try {
      const draft = await getOrCreateDraft({ circleId: selectedCircle._id });
      const resolvedLocations = await resolvePickerAssetLocations(result.assets);

      let successCount = 0;

      for (const [index, asset] of result.assets.entries()) {
        const resolvedLocation = resolvedLocations[index];
        const queueId = `${draft.shareBatchId}:${asset.assetId ?? asset.uri}:${index}:${Date.now()}`;
        setUploadQueue((state) =>
          enqueue(state, {
            id: queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            kind: assetKind(asset),
            fileName: fileNameFromPickerAsset(asset),
            mimeType: mimeTypeForPickerAsset(asset),
            fileUri: asset.uri,
            previewUri: asset.uri,
            locationLabel: formatMediaLocation(resolvedLocation) ?? undefined,
            status: 'processing',
            attempts: 0,
          }),
        );

        try {
          const processedAsset = await optimizePickerAsset(asset, resolvedLocation);
          const prepared = await createTarget({
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            kind: processedAsset.kind,
            mimeType: processedAsset.mimeType,
            fileName: processedAsset.fileName,
          });
          setUploadQueue((state) =>
            patchUploadQueueItem(state, queueId, {
              uploadId: prepared.uploadId,
            }),
          );

          setUploadQueue((state) => markUploadStatus(state, queueId, 'uploading'));

          const uploaded = await uploadPreparedFile({
            target: prepared.target,
            asset: processedAsset,
          });

          await completeUpload({
            uploadId: prepared.uploadId,
            storageId: uploaded.storageId,
            objectKey: uploaded.objectKey,
            fileName: processedAsset.fileName,
            sizeBytes: processedAsset.sizeBytes,
            width: processedAsset.width,
            height: processedAsset.height,
            durationSeconds: processedAsset.durationSeconds,
            location: processedAsset.location,
          });

          successCount += 1;
          setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === queueId));
        } catch (error) {
          setUploadQueue((state) =>
            markUploadStatus(
              state,
              queueId,
              'failed',
              error instanceof Error ? error.message : 'Upload fehlgeschlagen.',
            ),
          );
        }
      }

      if (successCount > 0) {
        setFeedback(
          successCount === result.assets.length
            ? 'Medien wurden zum Entwurf hinzugefügt.'
            : `${successCount} von ${result.assets.length} Medien wurden zum Entwurf hinzugefügt.`,
        );
      } else {
        setFeedback('Kein Asset konnte hochgeladen werden.');
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Medien konnten nicht hinzugefügt werden.');
    } finally {
      setIsUploading(false);
    }
  }, [completeUpload, createTarget, getOrCreateDraft, selectedCircle]);

  const handlePublishDraft = useCallback(async () => {
    if (!activeDraft) return;

    setIsPublishing(true);

    try {
      await publishDraft({
        shareBatchId: activeDraft._id,
        caption: draftCaption.trim() || undefined,
      });
      setUploadQueue((state) =>
        removeUploadQueueItems(state, (item) => item.shareBatchId === activeDraft._id),
      );
      setDraftCaption('');
      setIsDraftSheetOpen(false);
      setFeedback('Beitrag wurde veröffentlicht.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Beitrag konnte nicht veröffentlicht werden.');
    } finally {
      setIsPublishing(false);
    }
  }, [activeDraft, draftCaption, publishDraft]);

  const handleOpenShare = useCallback(
    (shareId: string) => router.push(`/share/${shareId}` as never),
    [router],
  );

  const handleOpenSettings = useCallback(() => {
    router.push('/(app)/settings' as never);
  }, [router]);

  const handleOpenDraftSheet = useCallback(() => {
    if (!selectedCircle) {
      setFeedback('Bitte wähle zuerst einen Circle aus.');
      return;
    }
    setIsDraftSheetOpen(true);
    // Also trigger media pick if no draft exists yet
    if (!activeDraft) {
      void handlePickMedia();
    }
  }, [selectedCircle, activeDraft, handlePickMedia]);

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  // ---------------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View style={[headerAnim, styles.headerPad]}>
            <HomeHeader
              displayName={displayName}
              profileImageUrl={profileImageUrl}
              onOpenSettings={handleOpenSettings}
            />
          </Animated.View>

          {/* Circle selector — edge-to-edge, manages its own inset */}
          {hasCircles ? (
            <Animated.View style={[circlesAnim, styles.circlesBlock]}>
              <View style={styles.circlesLabelRow}>
                <Text style={[styles.circlesLabel, { color: theme.textTertiary }]}>
                  Deine Circles
                </Text>
                <Text style={[styles.circlesCount, { color: theme.textTertiary }]}>
                  {circles!.length.toString().padStart(2, '0')}
                </Text>
              </View>
              <CircleSelector
                circles={circles!}
                activeCircleId={activeCircleId}
                onSelect={handleSelectCircle}
              />
            </Animated.View>
          ) : null}

          {/* Feed */}
          <Animated.View style={[feedAnim, styles.feedSection]}>
            {isViewerBootstrapping || circles === undefined ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : !hasCircles ? (
              <EmptyState
                icon="people-outline"
                message="Erstelle deinen ersten Circle in den Einstellungen, um loszulegen."
              />
            ) : !selectedCircle ? (
              <EmptyState
                icon="albums-outline"
                message="Wähle einen Circle aus, um den Feed zu sehen."
              />
            ) : shareFeed === undefined ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : shareFeed.length === 0 ? (
              <EmptyState
                icon="images-outline"
                title="Noch keine Beiträge"
                message={`Teile dein erstes Foto oder Video mit ${selectedCircle.name}.`}
              />
            ) : (
              <>
                <View style={styles.feedHeaderRow}>
                  <Text style={[styles.feedEyebrow, { color: theme.textTertiary }]}>
                    Aktuelles aus
                  </Text>
                  <Text
                    style={[styles.feedCircleName, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {selectedCircle.name}
                  </Text>
                </View>
                <View style={styles.feedList}>
                  {shareFeed.map((share, idx) => (
                    <View key={share._id}>
                      {idx > 0 ? <Ornament /> : null}
                      <FeedCard
                        share={share}
                        currentUserId={viewer?._id ?? null}
                        currentProfileImageUrl={profileImageUrl}
                        isDeleting={deletingShareId === share._id}
                        onOpenShare={handleOpenShare}
                        onDeleteShare={handleDeletePublishedShare}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>

        {/* FAB */}
        {hasCircles && selectedCircle ? (
          <ComposeFab
            hasDraft={Boolean(activeDraft)}
            draftAssetCount={activeDraft?.assetCount ?? 0}
            isUploading={isUploading}
            onPress={handleOpenDraftSheet}
          />
        ) : null}

        {/* Draft sheet */}
        <DraftSheet
          visible={isDraftSheetOpen}
          circle={selectedCircle}
          draft={activeDraft}
          caption={draftCaption}
          onChangeCaption={setDraftCaption}
          isDraftLoading={isDraftLoading}
          isUploading={isUploading}
          isPublishing={isPublishing}
          isDeletingDraft={Boolean(activeDraft && deletingShareId === activeDraft._id)}
          canPublish={canPublish}
          uploadQueue={{ items: selectedQueueItems }}
          onPickMedia={() => void handlePickMedia()}
          onPublish={() => void handlePublishDraft()}
          onDeleteDraft={handleDeleteDraft}
          onDeleteAsset={handleDeleteAsset}
          onRemoveFailedUpload={(itemId) => void handleRemoveFailedUpload(itemId)}
          onClose={() => setIsDraftSheetOpen(false)}
        />

        <FeedbackToast message={feedback} onDismiss={handleDismissFeedback} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: BottomTabInset + Spacing['3xl'],
  },
  headerPad: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  circlesBlock: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  circlesLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  circlesLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  circlesCount: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  feedSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.md,
  },
  feedEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  feedCircleName: {
    flex: 1,
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.base,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  feedList: {
    gap: Spacing.sm,
  },
  loadingContainer: {
    paddingVertical: Spacing['4xl'],
    alignItems: 'center',
  },
});
