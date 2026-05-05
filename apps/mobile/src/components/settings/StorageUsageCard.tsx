import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ConnectionCheck, StorageUsageStats } from '@beisammen/contracts';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes } from '@/features/media/client';

import { Button, Card, LoadingBox } from '@/components/ui';

interface StorageUsageCardProps {
  stats: StorageUsageStats | undefined;
  connectionCheck?: ConnectionCheck | null;
  isCheckingConnection?: boolean;
  onCheckConnection?: () => void;
}

export const StorageUsageCard = memo(function StorageUsageCard({
  stats,
  connectionCheck = null,
  isCheckingConnection = false,
  onCheckConnection,
}: StorageUsageCardProps) {
  const theme = useTheme();

  if (stats === undefined) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.content}>
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
          <StatColumn
            icon="albums-outline"
            value={stats.isTruncated ? `${stats.circleCount}+` : String(stats.circleCount)}
            label="Circles"
          />
        </View>
        {stats.isTruncated ? (
          <Text style={[styles.truncatedHint, { color: theme.textSecondary }]}>
            Speicherwerte zeigen die zuletzt geladenen {stats.circleCount} Circles.
          </Text>
        ) : null}

        {onCheckConnection ? (
          <ConnectionCheckRow
            connectionCheck={connectionCheck}
            isCheckingConnection={isCheckingConnection}
            onCheckConnection={onCheckConnection}
          />
        ) : null}
      </View>
    </Card>
  );
});

const ConnectionCheckRow = memo(function ConnectionCheckRow({
  connectionCheck,
  isCheckingConnection,
  onCheckConnection,
}: {
  connectionCheck: ConnectionCheck | null;
  isCheckingConnection: boolean;
  onCheckConnection: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.connection, { borderTopColor: theme.borderLight }]}>
      <Button
        label={isCheckingConnection ? 'Prüft...' : 'Speicher prüfen'}
        icon={connectionCheck?.ok ? 'checkmark-circle-outline' : 'cloud-outline'}
        variant="outline"
        loading={isCheckingConnection}
        onPress={onCheckConnection}
      />
      {connectionCheck ? (
        <Text
          style={[
            styles.connectionMessage,
            { color: connectionCheck.ok ? theme.primary : theme.danger },
          ]}
        >
          {connectionCheck.message}
        </Text>
      ) : null}
    </View>
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
  content: {
    gap: Spacing.md,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.sm,
  },
  truncatedHint: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    lineHeight: 16,
    textAlign: 'center',
  },
  connection: {
    borderTopWidth: 1,
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  connectionMessage: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 18,
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
