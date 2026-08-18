import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useGT } from 'gt-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ShareAssetRecord } from '@/features/convex/api';
import { formatBytes } from '@/features/media/client';
import { useAssetMediaUri } from '@/features/media/use-asset-media-uri';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface AssetThumbnailProps {
  asset: ShareAssetRecord;
  /** Needed to resolve encrypted media; every render site knows its circle. */
  circleId?: string | null;
  size?: number;
  onPress?: () => void;
  onRemove?: () => void;
}

export const AssetThumbnail = memo(function AssetThumbnail({
  asset,
  circleId,
  size = 104,
  onPress,
  onRemove,
}: AssetThumbnailProps) {
  const theme = useTheme();
  const gt = useGT();
  const signedUrl = useAssetMediaUri(
    asset.kind === 'image' || asset.previewStorage ? asset : null,
    'preview',
    circleId,
  );
  const metaLabel = asset.kind === 'video' ? gt('Video') : formatBytes(asset.sizeBytes);
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      {...(onPress
        ? {
            accessibilityRole: 'imagebutton' as const,
            accessibilityLabel: gt('Medium im Vollbild ansehen'),
          }
        : {})}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          backgroundColor: theme.background,
          borderColor: theme.border,
        },
      ]}
    >
      {signedUrl ? (
        <Image
          source={{ uri: signedUrl }}
          style={styles.image}
          contentFit="cover"
          recyclingKey={asset._id}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              backgroundColor: asset.kind === 'video' ? theme.accentMuted : theme.surfacePressed,
            },
          ]}
        >
          <Ionicons
            name={asset.kind === 'video' ? 'play-circle-outline' : 'image-outline'}
            size={24}
            color={asset.kind === 'video' ? theme.accent : theme.textTertiary}
          />
        </View>
      )}

      <View style={[styles.meta, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <Text style={styles.metaText} numberOfLines={1}>
          {metaLabel ?? asset.fileName ?? (asset.kind === 'video' ? gt('Video') : gt('Bild'))}
        </Text>
      </View>

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          style={[styles.removeButton, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
        >
          <Ionicons name="close" size={14} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Container>
  );
});

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  metaText: {
    color: '#FFFFFF',
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
