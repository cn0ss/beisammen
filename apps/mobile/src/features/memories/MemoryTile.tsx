import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useGT } from 'gt-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MediaLocation } from '@beisammen/contracts';

import { Radius } from '@/constants/theme';
import type { AssetEncryptionEnvelope } from '@/features/crypto/asset-metadata';
import { formatMediaLocation } from '@/features/media/client';
import { useAssetMediaUri } from '@/features/media/use-asset-media-uri';
import { useDecryptedAssetLocation } from '@/features/media/use-decrypted-asset-location';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

const MEMORY_DAY_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
};

function formatMemoryDay(timestamp: number, format: Intl.DateTimeFormat): string {
  return format.format(new Date(timestamp));
}

/** Structural subset a tile needs — satisfied by MemoryItemRecord and LocatedMemoryItem. */
export interface MemoryTileData {
  _id: string;
  assetId: string;
  circleId: string;
  kind: 'image' | 'video';
  circleName: string;
  capturedAt: number | null;
  timelineAt: number;
  placeLabel: string | null;
  location?: MediaLocation | null;
  /** Carries the encryption envelope so encrypted media resolves to previews. */
  asset?: {
    mimeType?: string;
    fileName?: string;
    encryption?: AssetEncryptionEnvelope;
  };
}

export const MemoryTile = memo(function MemoryTile({
  item,
  onOpen,
  size,
}: {
  item: MemoryTileData;
  onOpen: (item: MemoryTileData) => void;
  size: number;
}) {
  const theme = useTheme();
  const gt = useGT();
  const memoryDayFormat = useDateFormat(MEMORY_DAY_FORMAT_OPTIONS);
  const signedUrl = useAssetMediaUri(
    {
      _id: item.assetId,
      kind: item.kind,
      mimeType: item.asset?.mimeType,
      fileName: item.asset?.fileName,
      encryption: item.asset?.encryption,
    },
    'preview',
    item.circleId,
  );
  const decryptedLocation = useDecryptedAssetLocation({
    assetId: item.assetId,
    encryption: item.asset?.encryption,
    circleId: item.circleId,
  });
  const locationLabel =
    item.placeLabel ?? formatMediaLocation(item.location ?? decryptedLocation ?? undefined);
  const dateLabel = formatMemoryDay(item.capturedAt ?? item.timelineAt, memoryDayFormat);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt('{dateLabel} aus {circleName} öffnen', {
        dateLabel,
        circleName: item.circleName,
      })}
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
        <Image
          source={{ uri: signedUrl }}
          style={styles.tileImage}
          contentFit="cover"
          recyclingKey={item.assetId}
        />
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
