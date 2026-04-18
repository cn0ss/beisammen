import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { StorageUsageStats } from '@beisammen/contracts';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes } from '@/features/media/client';

import { Card, LoadingBox } from '@/components/ui';

interface StorageUsageCardProps {
  stats: StorageUsageStats | undefined;
}

export const StorageUsageCard = memo(function StorageUsageCard({
  stats,
}: StorageUsageCardProps) {
  if (stats === undefined) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.grid}>
        <StatColumn
          icon="image-outline"
          value={String(stats.imageCount)}
          label="Fotos"
        />
        <StatColumn
          icon="videocam-outline"
          value={String(stats.videoCount)}
          label="Videos"
        />
        <StatColumn
          icon="cloud-outline"
          value={formatBytes(stats.totalSizeBytes) ?? '0 KB'}
          label="Speicher"
        />
      </View>
    </Card>
  );
});

const StatColumn = memo(function StatColumn({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.stat}>
      <View style={[styles.iconCircle, { backgroundColor: theme.primaryMuted }]}>
        <Ionicons name={icon} size={18} color={theme.primary} />
      </View>
      <Text style={[styles.value, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.sm,
  },
  stat: {
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  value: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
