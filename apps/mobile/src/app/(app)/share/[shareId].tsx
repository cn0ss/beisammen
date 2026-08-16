import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import { useAction, useConvexAuth, useQuery } from 'convex/react';
import { VideoView, useVideoPlayer } from 'expo-video';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { ShareAssetRecord } from '@/features/convex/api';
import { api } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import {
  downloadAssetToCache,
  formatMediaLocation,
  formatBytes,
  saveAssetToDeviceLibrary,
  shareLocalFile,
} from '@/features/media/client';
import { useSignedAssetUrl } from '@/features/media/use-signed-asset-url';
import { useTheme } from '@/hooks/use-theme';

import { AssetThumbnail } from '@/components/media/AssetThumbnail';
import { Button, FeedbackToast, LoadingBox } from '@/components/ui';
import { EngagementPanel } from '@/components/share/EngagementPanel';

function splitLead(caption: string): { lead: string; tail: string | null } {
  const trimmed = caption.trim();
  const match = trimmed.match(/^([^.!?]{3,80}[.!?])\s+(.+)$/s);
  if (!match) {
    return { lead: trimmed, tail: null };
  }
  return { lead: match[1], tail: match[2] };
}

function CaptionBlock({
  caption,
  accentColor,
  baseColor,
}: {
  caption: string;
  accentColor: string;
  baseColor: string;
}) {
  const { lead, tail } = splitLead(caption);
  return (
    <View style={styles.captionBlock}>
      <Text style={[styles.captionLead, { color: baseColor }]}>{lead}</Text>
      {tail ? (
        <Text style={[styles.captionTail, { color: accentColor }]}>{tail}</Text>
      ) : null}
    </View>
  );
}

function formatDuration(durationSeconds?: number): string | null {
  if (!durationSeconds || durationSeconds <= 0) {
    return null;
  }

  const totalSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const ASSET_DATE_FORMAT = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
});

function formatCapturedDate(capturedAt?: number): string | null {
  if (!capturedAt || capturedAt <= 0) {
    return null;
  }

  return ASSET_DATE_FORMAT.format(new Date(capturedAt));
}

function ShareAssetViewer({ asset }: { asset: ShareAssetRecord | null }) {
  const theme = useTheme();
  const isFocused = useIsFocused();
  const signedUrl = useSignedAssetUrl(asset?._id, 'original');
  const player = useVideoPlayer(asset?.kind === 'video' ? signedUrl : null, (instance) => {
    instance.pause();
  });

  useEffect(() => {
    if (!isFocused && asset?.kind === 'video') {
      try {
        player.pause();
      } catch {
        // useVideoPlayer releases the native object on unmount; ignore stale cleanup calls.
      }
    }
  }, [asset?.kind, isFocused, player, signedUrl]);

  if (!asset) {
    return (
      <View style={[styles.viewerFallback, { backgroundColor: theme.surfacePressed }]}>
        <Ionicons name="images-outline" size={32} color={theme.textTertiary} />
      </View>
    );
  }

  if (asset.kind === 'video') {
    return (
      <View style={[styles.viewer, { backgroundColor: '#050505' }]}>
        {signedUrl ? (
          <VideoView
            player={player}
            style={styles.viewerMedia}
            nativeControls
            contentFit="contain"
          />
        ) : (
          <View style={styles.viewerFallback}>
            <Ionicons name="play-circle-outline" size={42} color="#FFFFFF" />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.viewer, { backgroundColor: theme.surfacePressed }]}>
      {signedUrl ? (
        <Image source={{ uri: signedUrl }} style={styles.viewerMedia} contentFit="contain" />
      ) : (
        <View style={styles.viewerFallback}>
          <Ionicons name="image-outline" size={32} color={theme.textTertiary} />
        </View>
      )}
    </View>
  );
}

export default function ShareDetailScreen() {
  const router = useRouter();
  const { session } = useSession();
  const convexAuth = useConvexAuth();
  const params = useLocalSearchParams<{
    shareId?: string | string[];
    assetId?: string | string[];
  }>();
  const shareId = Array.isArray(params.shareId) ? params.shareId[0] : params.shareId;
  const requestedAssetId = Array.isArray(params.assetId) ? params.assetId[0] : params.assetId;
  const theme = useTheme();

  const [isDeleted, setIsDeleted] = useState(false);
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const isViewerBootstrapping =
    Boolean(session && convexAuth.isAuthenticated) &&
    (viewerState === undefined || (viewerState.isAuthenticated && viewerState.viewer === null));
  const share = useQuery(
    api.shares.getById,
    shareId && hasViewer && !isDeleted ? { shareBatchId: shareId } : 'skip',
  );
  const circle = useQuery(
    api.circles.getById,
    share ? { circleId: share.circleId } : 'skip',
  );
  const getReadUrl = useAction(api.assets.getReadUrl);
  const deleteShare = useAction(api.shares.delete);

  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!isViewerBootstrapping && share === null) {
      router.replace('/home');
    }
  }, [isViewerBootstrapping, router, share]);

  useEffect(() => {
    if (!share) {
      return;
    }

    setActiveAssetId((current) =>
      current && share.assets.some((asset) => asset._id === current)
        ? current
        : requestedAssetId && share.assets.some((asset) => asset._id === requestedAssetId)
          ? requestedAssetId
        : share.assets[0]?._id ?? null,
    );
  }, [requestedAssetId, share]);

  const activeAsset = useMemo(
    () => share?.assets.find((asset) => asset._id === activeAssetId) ?? share?.assets[0] ?? null,
    [activeAssetId, share],
  );
  const activeAssetUrl = useSignedAssetUrl(activeAsset?._id, 'original');

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSave = useCallback(async () => {
    if (!activeAsset) {
      return;
    }

    setIsSaving(true);
    try {
      const signed =
        activeAssetUrl
          ? { url: activeAssetUrl }
          : await getReadUrl({ assetId: activeAsset._id, variant: 'original' });
      if (!signed.url) {
        throw new Error('Datei ist nicht mehr im Speicher vorhanden.');
      }
      const localUri = await downloadAssetToCache({
        asset: activeAsset,
        url: signed.url,
      });
      await saveAssetToDeviceLibrary(localUri);
      setFeedback('Medium wurde auf dem Gerät gespeichert.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Medium konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  }, [activeAsset, activeAssetUrl, getReadUrl]);

  const handleShare = useCallback(async () => {
    if (!activeAsset) {
      return;
    }

    setIsSharing(true);
    try {
      const signed =
        activeAssetUrl
          ? { url: activeAssetUrl }
          : await getReadUrl({ assetId: activeAsset._id, variant: 'original' });
      if (!signed.url) {
        throw new Error('Datei ist nicht mehr im Speicher vorhanden.');
      }
      const localUri = await downloadAssetToCache({
        asset: activeAsset,
        url: signed.url,
      });
      await shareLocalFile(localUri);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Medium konnte nicht geteilt werden.');
    } finally {
      setIsSharing(false);
    }
  }, [activeAsset, activeAssetUrl, getReadUrl]);

  const performDelete = useCallback(async () => {
    if (!share) {
      return;
    }

    setIsDeleting(true);
    setIsDeleted(true);
    try {
      await deleteShare({ shareBatchId: share._id });
      router.replace('/home');
    } catch (error) {
      setIsDeleted(false);
      setFeedback(error instanceof Error ? error.message : 'Beitrag konnte nicht gelöscht werden.');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteShare, router, share]);

  const handleDelete = useCallback(() => {
    if (!share?.canDelete) {
      return;
    }

    Alert.alert(
      'Beitrag löschen?',
      'Dieser Beitrag und alle Medien werden dauerhaft entfernt.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => {
            void performDelete();
          },
        },
      ],
    );
  }, [performDelete, share?.canDelete]);

  if (isViewerBootstrapping || (shareId && hasViewer && share === undefined)) {
    return <LoadingBox />;
  }

  if (!shareId || share === undefined || share === null) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.loadingState}>
          <LoadingBox />
        </View>
      </SafeAreaView>
    );
  }

  const activeAssetMeta = [
    formatCapturedDate(activeAsset?.capturedAt),
    formatBytes(activeAsset?.sizeBytes),
    formatDuration(activeAsset?.durationSeconds),
  ]
    .filter(Boolean)
    .join(' · ');
  const activeAssetLocation = formatMediaLocation(activeAsset?.location);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleBack}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: theme.surface,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-back" size={18} color={theme.text} />
          </Pressable>

          {circle ? (
            <Text
              style={[styles.circleLabel, { color: theme.text }]}
              numberOfLines={1}
            >
              {circle.name}
            </Text>
          ) : (
            <View style={styles.circleLabelPlaceholder} />
          )}

          {share.canDelete ? (
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: theme.dangerMuted,
                  opacity: pressed || isDeleting ? 0.82 : 1,
                },
              ]}
            >
              <Ionicons name="trash-outline" size={18} color={theme.danger} />
            </Pressable>
          ) : (
            <View style={styles.iconButtonPlaceholder}>
              <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
            </View>
          )}
        </View>

        <View style={styles.metaBlock}>
          <Text style={[styles.authorName, { color: theme.text }]}>{share.authorName}</Text>
          <Text style={[styles.timestamp, { color: theme.textSecondary }]}>{share.createdAtLabel}</Text>
        </View>

        {share.caption ? (
          <CaptionBlock caption={share.caption} accentColor={theme.accent} baseColor={theme.text} />
        ) : null}

        <ShareAssetViewer asset={activeAsset} />

        {activeAsset ? (
          <View style={styles.assetInfo}>
            <Text style={[styles.assetFileName, { color: theme.text }]} numberOfLines={1}>
              {activeAsset.fileName ?? (activeAsset.kind === 'video' ? 'video.mp4' : 'image.jpg')}
            </Text>
            {activeAssetMeta ? (
              <Text style={[styles.assetMeta, { color: theme.textSecondary }]}>{activeAssetMeta}</Text>
            ) : null}
            {activeAssetLocation ? (
              <Text style={[styles.assetLocation, { color: theme.textSecondary }]}>
                {activeAssetLocation}
              </Text>
            ) : null}
          </View>
        ) : null}

        {share.assets.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbnailRow}
          >
            {share.assets.map((asset) => (
              <AssetThumbnail
                key={asset._id}
                asset={asset}
                size={96}
                onPress={() => setActiveAssetId(asset._id)}
              />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.actionRow}>
          <Button
            label={isSaving ? 'Speichert...' : 'Speichern'}
            icon="download-outline"
            loading={isSaving}
            onPress={() => {
              void handleSave();
            }}
          />
          <Button
            label={isSharing ? 'Teilt...' : 'Teilen'}
            icon="share-social-outline"
            variant="outline"
            loading={isSharing}
            onPress={() => {
              void handleShare();
            }}
          />
        </View>

        <EngagementPanel share={share} activeAsset={activeAsset} onFeedback={setFeedback} />
      </ScrollView>

      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingState: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPlaceholder: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.md,
    paddingHorizontal: Spacing.sm,
  },
  circleLabelPlaceholder: {
    flex: 1,
  },
  metaBlock: {
    gap: 4,
  },
  authorName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  timestamp: {
    fontSize: FontSize.sm,
  },
  captionBlock: {
    gap: 4,
  },
  captionLead: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  captionTail: {
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.lg,
    lineHeight: 28,
  },
  viewer: {
    minHeight: 340,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  viewerMedia: {
    width: '100%',
    height: 340,
  },
  viewerFallback: {
    width: '100%',
    height: 340,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetInfo: {
    gap: 4,
  },
  assetFileName: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  assetMeta: {
    fontSize: FontSize.sm,
  },
  assetLocation: {
    fontSize: FontSize.sm,
  },
  thumbnailRow: {
    gap: Spacing.sm,
  },
  actionRow: {
    gap: Spacing.sm,
  },
});
