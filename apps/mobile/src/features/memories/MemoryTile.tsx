import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius } from '@/constants/theme';
import type { MemoryItemRecord } from '@/features/convex/api';
import { formatMediaLocation } from '@/features/media/client';
import { useSignedAssetUrl } from '@/features/media/use-signed-asset-url';
import { useTheme } from '@/hooks/use-theme';

const MEMORY_DAY_FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: 'short',
});

function formatMemoryDay(timestamp: number): string {
  return MEMORY_DAY_FORMAT.format(new Date(timestamp));
}

export const MemoryTile = memo(function MemoryTile({
  item,
  onOpen,
  size,
}: {
  item: MemoryItemRecord;
  onOpen: (item: MemoryItemRecord) => void;
  size: number;
}) {
  const theme = useTheme();
  const signedUrl = useSignedAssetUrl(item.assetId, 'preview');
  const locationLabel = item.placeLabel ?? formatMediaLocation(item.location ?? undefined);
  const dateLabel = formatMemoryDay(item.capturedAt ?? item.timelineAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dateLabel} aus ${item.circleName} öffnen`}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [
        styles.tile,
        {
          width: size,
          height: size,
          backgroundColor: theme.surfacePressed,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      {signedUrl ? (
        <Image source={{ uri: signedUrl }} style={styles.tileImage} contentFit="cover" />
      ) : (
        <View style={styles.tileFallback}>
          <Ionicons
            name={item.kind === 'video' ? 'play-circle-outline' : 'image-outline'}
            size={24}
            color={theme.textTertiary}
          />
        </View>
      )}

      {item.kind === 'video' ? (
        <View style={styles.videoBadge}>
          <Ionicons name="play" size={10} color="#FFFFFF" />
        </View>
      ) : null}

      <View style={styles.tileOverlay}>
        <Text style={styles.tileDate} numberOfLines={1}>
          {dateLabel}
        </Text>
        <Text style={styles.tileMeta} numberOfLines={1}>
          {locationLabel ?? item.circleName}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    borderRadius: Radius.md,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 1,
    paddingHorizontal: 7,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  tileDate: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  tileMeta: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 9,
    fontWeight: '700',
  },
});
