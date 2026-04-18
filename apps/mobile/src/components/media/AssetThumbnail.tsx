import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ShareAssetRecord } from '@/features/convex/api';
import { formatBytes } from '@/features/media/client';
import { useSignedAssetUrl } from '@/features/media/use-signed-asset-url';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface AssetThumbnailProps {
  asset: ShareAssetRecord;
  size?: number;
  onPress?: () => void;
  onRemove?: () => void;
}

export const AssetThumbnail = memo(function AssetThumbnail({
  asset,
  size = 104,
  onPress,
  onRemove,
}: AssetThumbnailProps) {
  const theme = useTheme();
  const signedUrl = useSignedAssetUrl(asset._id);
  const metaLabel = asset.kind === 'video' ? 'Video' : formatBytes(asset.sizeBytes);
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
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
      {asset.kind === 'image' && signedUrl ? (
        <Image source={{ uri: signedUrl }} style={styles.image} contentFit="cover" />
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
          {metaLabel ?? asset.fileName ?? (asset.kind === 'video' ? 'Video' : 'Bild')}
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
