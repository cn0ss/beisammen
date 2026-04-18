import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { CircleListItem } from '@/features/convex/api';
import { useCircleImageUrl } from '@/features/media/use-circle-image-url';
import { useTheme } from '@/hooks/use-theme';

import { Card, LoadingBox, Avatar } from '@/components/ui';

import { settingsCopy } from './copy';

interface CirclesListProps {
  circles: CircleListItem[] | undefined;
  busyCircleId?: string | null;
  onOpenCircle: (circle: CircleListItem) => void;
  onPickCircleImage: (circle: CircleListItem) => void;
  onRemoveCircleImage: (circle: CircleListItem) => void;
}

export const CirclesList = memo(function CirclesList({
  circles,
  busyCircleId,
  onOpenCircle,
  onPickCircleImage,
  onRemoveCircleImage,
}: CirclesListProps) {
  const theme = useTheme();

  if (circles === undefined) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  if (circles.length === 0) {
    return (
      <Card>
        <View style={styles.emptyRow}>
          <Ionicons name="albums-outline" size={20} color={theme.textTertiary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            {settingsCopy.emptyCirclesLabel}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      {circles.map((circle, index) => (
        <CircleRow
          key={circle._id}
          circle={circle}
          isBusy={busyCircleId === circle._id}
          hasSeparator={index < circles.length - 1}
          onOpenCircle={onOpenCircle}
          onPickCircleImage={onPickCircleImage}
          onRemoveCircleImage={onRemoveCircleImage}
        />
      ))}
    </Card>
  );
});

const CircleRow = memo(function CircleRow({
  circle,
  hasSeparator,
  isBusy,
  onOpenCircle,
  onPickCircleImage,
  onRemoveCircleImage,
}: {
  circle: CircleListItem;
  hasSeparator: boolean;
  isBusy: boolean;
  onOpenCircle: (circle: CircleListItem) => void;
  onPickCircleImage: (circle: CircleListItem) => void;
  onRemoveCircleImage: (circle: CircleListItem) => void;
}) {
  const theme = useTheme();
  const imageUrl = useCircleImageUrl(circle._id, circle.hasImage);

  return (
    <View
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <Avatar name={circle.name} imageUrl={imageUrl} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: theme.text }]}>{circle.name}</Text>
        <Text style={[styles.meta, { color: theme.textTertiary }]}>
          {circle.memberCount} Mitglieder · {circle.role}
        </Text>
      </View>
      <View style={styles.tools}>
        <CircleIconButton
          icon={circle.canManage ? 'settings-outline' : 'eye-outline'}
          label={circle.canManage ? 'Verwalten' : 'Ansehen'}
          onPress={() => onOpenCircle(circle)}
          disabled={isBusy}
        />
        {circle.canManage ? (
          <CircleIconButton
            icon={circle.hasImage ? 'create-outline' : 'image-outline'}
            label={circle.hasImage ? 'Bild ändern' : 'Bild wählen'}
            onPress={() => onPickCircleImage(circle)}
            disabled={isBusy}
          />
        ) : null}
        {circle.canManage && circle.hasImage ? (
          <CircleIconButton
            icon="trash-outline"
            label="Bild entfernen"
            onPress={() => onRemoveCircleImage(circle)}
            disabled={isBusy}
            tone="danger"
          />
        ) : null}
      </View>
    </View>
  );
});

const CircleIconButton = memo(function CircleIconButton({
  icon,
  label,
  onPress,
  disabled,
  tone = 'default',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled: boolean;
  tone?: 'default' | 'danger';
}) {
  const theme = useTheme();
  const backgroundColor = tone === 'danger' ? theme.dangerMuted : theme.accentMuted;
  const color = tone === 'danger' ? theme.danger : theme.accent;

  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: FontSize.xs,
  },
  tools: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
