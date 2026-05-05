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

import { useAction, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react';

import { BottomTabInset, Fonts, FontSize, Spacing } from '@/constants/theme';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { useProfileImageUrl } from '@/features/media/use-profile-image-url';
import { useShareUploadFlow } from '@/features/media/use-share-upload-flow';
import { useTheme } from '@/hooks/use-theme';
import { createLogger } from '@/lib/logger';

import { Button, EmptyState, FeedbackToast, LoadingBox } from '@/components/ui';
import { CircleSelector } from '@/components/home/CircleSelector';
import { ComposeFab } from '@/components/home/ComposeFab';
import { DraftSheet } from '@/components/home/DraftSheet';
import { FeedCard } from '@/components/home/FeedCard';
import { HomeHeader } from '@/components/home/HomeHeader';
import { Ornament } from '@/components/home/Ornament';

const logger = createLogger('home');

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
  const circlesPage = usePaginatedQuery(
    api.circles.listForViewer,
    hasViewer ? {} : 'skip',
    { initialNumItems: 20 },
  );
  const circles = hasViewer ? circlesPage.results : undefined;
  const selectedCircle = circles?.find((circle) => circle._id === activeCircleId) ?? null;
  const shareFeed = usePaginatedQuery(
    api.shares.listForCircle,
    hasViewer && activeCircleId ? { circleId: activeCircleId } : 'skip',
    { initialNumItems: 10 },
  );
  const activeDraft = useQuery(
    api.shares.getDraftForCircle,
    hasViewer && activeCircleId ? { circleId: activeCircleId } : 'skip',
  );
  const updateDraft = useMutation(api.shares.updateDraft);
  const publishDraft = useMutation(api.shares.publish);
  const deleteDraftAsset = useAction(api.assets.deleteDraftAsset);
  const deleteShare = useAction(api.shares.delete);

  const [draftCaption, setDraftCaption] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingShareId, setDeletingShareId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isDraftSheetOpen, setIsDraftSheetOpen] = useState(false);
  const customProfileImageUrl = useProfileImageUrl(Boolean(viewer?.hasProfileImage));
  const {
    selectedQueueItems,
    hasUnresolvedUploads,
    isUploading,
    handlePickMedia,
    handleRetryFailedUpload,
    handleRemoveFailedUpload,
    handleDiscardUpload,
    removeItemsForShareBatch,
  } = useShareUploadFlow({
    selectedCircle,
    activeDraft,
    existingDraftAssetCount: activeDraft?.assetCount ?? 0,
    onFeedback: setFeedback,
  });

  // ---------------------------------------------------------------------------
  //  Auto-select first circle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (hasViewer && circlesPage.status === 'LoadingFirstPage') {
      return;
    }

    if (!circles || circles.length === 0) {
      if (activeCircleId) setActiveCircleId(null);
      return;
    }
    if (!activeCircleId || !circles.some((circle) => circle._id === activeCircleId)) {
      setActiveCircleId(circles[0]?._id ?? null);
    }
  }, [activeCircleId, circles, circlesPage.status, hasViewer, setActiveCircleId]);

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
        logger.warn('Draft update failed', {
          shareBatchId: activeDraft._id,
          error,
        });
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
  const isCirclesLoading = hasViewer && circlesPage.status === 'LoadingFirstPage';
  const isLoadingMoreCircles = circlesPage.status === 'LoadingMore';
  const isViewerBootstrapping =
    Boolean(session) &&
    (
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated ||
      viewerState === undefined ||
      (viewerState.isAuthenticated && !viewer)
    );

  const feedItems = shareFeed.results;
  const isFeedLoading = Boolean(activeCircleId) && shareFeed.status === 'LoadingFirstPage';
  const isLoadingMoreFeed = shareFeed.status === 'LoadingMore';
  const visiblePersistedUploads =
    activeDraft?.unresolvedUploads.filter(
      (upload) => !selectedQueueItems.some((item) => item.uploadId === upload._id),
    ) ?? [];
  const hasPersistedUnresolvedUploads = visiblePersistedUploads.length > 0;
  const canPublish = Boolean(
    activeDraft &&
      activeDraft.assets.length > 0 &&
      !hasUnresolvedUploads &&
      !hasPersistedUnresolvedUploads,
  );
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
        removeItemsForShareBatch(shareBatchId);
        if (activeDraft?._id === shareBatchId) {
          setDraftCaption('');
        }
        setFeedback(successMessage);
      } catch (error) {
        logger.warn('Share delete failed', {
          shareBatchId,
          error,
        });
        setFeedback(error instanceof Error ? error.message : 'Beitrag konnte nicht gelöscht werden.');
      } finally {
        setDeletingShareId(null);
      }
    },
    [activeDraft?._id, deleteShare, removeItemsForShareBatch],
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
                  logger.warn('Draft asset delete failed', {
                    assetId,
                    error,
                  });
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

  const handleDiscardPersistedUpload = useCallback(
    (uploadId: string) => {
      void handleDiscardUpload(uploadId)
        .then(() => {
          setFeedback('Unterbrochener Upload wurde entfernt.');
        })
        .catch((error) => {
          logger.warn('Persisted upload discard failed', {
            uploadId,
            error,
          });
          setFeedback(
            error instanceof Error
              ? error.message
              : 'Unterbrochener Upload konnte nicht entfernt werden.',
          );
        });
    },
    [handleDiscardUpload],
  );

  const handlePublishDraft = useCallback(async () => {
    if (!activeDraft) return;

    setIsPublishing(true);

    try {
      await publishDraft({
        shareBatchId: activeDraft._id,
        caption: draftCaption.trim() || undefined,
      });
      removeItemsForShareBatch(activeDraft._id);
      setDraftCaption('');
      setIsDraftSheetOpen(false);
      setFeedback('Beitrag wurde veröffentlicht.');
    } catch (error) {
      logger.warn('Draft publish failed', {
        shareBatchId: activeDraft._id,
        error,
      });
      setFeedback(error instanceof Error ? error.message : 'Beitrag konnte nicht veröffentlicht werden.');
    } finally {
      setIsPublishing(false);
    }
  }, [activeDraft, draftCaption, publishDraft, removeItemsForShareBatch]);

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
              {circlesPage.status !== 'Exhausted' ? (
                <View style={styles.circleLoadMore}>
                  <Button
                    label={isLoadingMoreCircles ? 'Lädt...' : 'Weitere Circles'}
                    icon="chevron-down-outline"
                    variant="outline"
                    loading={isLoadingMoreCircles}
                    disabled={isLoadingMoreCircles}
                    onPress={() => circlesPage.loadMore(20)}
                  />
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {/* Feed */}
          <Animated.View style={[feedAnim, styles.feedSection]}>
            {isViewerBootstrapping || circles === undefined || isCirclesLoading ? (
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
            ) : isFeedLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : feedItems.length === 0 ? (
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
                  {feedItems.map((share, idx) => (
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
                  {shareFeed.status !== 'Exhausted' ? (
                    <Button
                      label={isLoadingMoreFeed ? 'Lädt...' : 'Mehr laden'}
                      icon="chevron-down-outline"
                      variant="outline"
                      loading={isLoadingMoreFeed}
                      disabled={isLoadingMoreFeed}
                      onPress={() => shareFeed.loadMore(10)}
                    />
                  ) : null}
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
          persistedUploads={visiblePersistedUploads}
          onPickMedia={() => void handlePickMedia()}
          onPublish={() => void handlePublishDraft()}
          onDeleteDraft={handleDeleteDraft}
          onDeleteAsset={handleDeleteAsset}
          onRetryFailedUpload={(itemId) => void handleRetryFailedUpload(itemId)}
          onRemoveFailedUpload={(itemId) => void handleRemoveFailedUpload(itemId)}
          onDiscardPersistedUpload={handleDiscardPersistedUpload}
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
  circleLoadMore: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
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
