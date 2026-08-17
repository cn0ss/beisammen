import Ionicons from '@expo/vector-icons/Ionicons';
import { T, useGT } from 'gt-react-native';
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ShareDraftRecord } from '@/features/convex/api';
import type { UploadQueueState } from '@beisammen/upload-client';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AssetThumbnail } from '@/components/media/AssetThumbnail';
import { Button, Card, LoadingBox } from '@/components/ui';

interface ComposerProps {
  draft: ShareDraftRecord | null | undefined;
  caption: string;
  onChangeCaption: (text: string) => void;
  isDraftLoading: boolean;
  isUploading: boolean;
  isPublishing: boolean;
  isDeletingDraft: boolean;
  canPublish: boolean;
  uploadQueue: UploadQueueState;
  onPickMedia: () => void;
  onPublish: () => void;
  onDeleteDraft: () => void;
  onDeleteAsset: (assetId: string) => void;
  onRemoveFailedUpload: (itemId: string) => void;
}

export const Composer = memo(function Composer({
  draft,
  caption,
  onChangeCaption,
  isDraftLoading,
  isUploading,
  isPublishing,
  isDeletingDraft,
  canPublish,
  uploadQueue,
  onPickMedia,
  onPublish,
  onDeleteDraft,
  onDeleteAsset,
  onRemoveFailedUpload,
}: ComposerProps) {
  const theme = useTheme();
  const gt = useGT();

  if (isDraftLoading) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  if (!draft && uploadQueue.items.length === 0) {
    return (
      <Card>
        <T>
          <Text style={[styles.helper, { color: theme.textSecondary }]}>
            Fotos und Videos bleiben zuerst privat im Entwurf. Veröffentlicht wird erst, wenn du
            bereit bist.
          </Text>
        </T>
        <Button
          label={isUploading ? gt('Medien werden vorbereitet...') : gt('Fotos oder Videos auswählen')}
          icon={isUploading ? 'cloud-upload-outline' : 'images-outline'}
          loading={isUploading}
          onPress={onPickMedia}
        />
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <View style={styles.headerInfo}>
          <T>
            <Text style={[styles.title, { color: theme.text }]}>Privater Entwurf</Text>
            <Text style={[styles.helper, { color: theme.textSecondary }]}>
              Nur du siehst diesen Entwurf, bis du ihn veröffentlichst.
            </Text>
          </T>
        </View>
        {draft ? (
          <Button
            label={gt('Löschen')}
            icon="trash-outline"
            variant="danger"
            loading={isDeletingDraft}
            disabled={isUploading || isPublishing}
            onPress={onDeleteDraft}
          />
        ) : null}
      </View>

      {draft ? (
        <TextInput
          value={caption}
          onChangeText={onChangeCaption}
          placeholder={gt('Schreib etwas dazu, wenn du magst')}
          placeholderTextColor={theme.textTertiary}
          multiline
          style={[
            styles.input,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
      ) : (
        <T>
          <Text style={[styles.helper, { color: theme.textSecondary }]}>
            Der Entwurf wird vorbereitet. Du kannst gleich Text ergänzen.
          </Text>
        </T>
      )}

      {draft?.assets.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.assetRow}
        >
          {draft.assets.map((asset) => (
            <AssetThumbnail
              key={asset._id}
              asset={asset}
              onRemove={() => onDeleteAsset(asset._id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {uploadQueue.items.length > 0 ? (
        <View style={styles.queueList}>
          {uploadQueue.items.map((item) => (
            <UploadQueueItem
              key={item.id}
              item={item}
              onRemove={item.status === 'failed' ? () => onRemoveFailedUpload(item.id) : undefined}
            />
          ))}
        </View>
      ) : null}

      <Button
        label={
          isUploading
            ? gt('Medien werden vorbereitet...')
            : gt('Weitere Fotos oder Videos hinzufügen')
        }
        icon={isUploading ? 'cloud-upload-outline' : 'images-outline'}
        loading={isUploading}
        disabled={isPublishing || isDeletingDraft}
        onPress={onPickMedia}
      />

      <Button
        label={isPublishing ? gt('Wird veröffentlicht...') : gt('Veröffentlichen')}
        icon="send-outline"
        variant="outline"
        loading={isPublishing}
        disabled={!canPublish || isUploading || isDeletingDraft}
        onPress={onPublish}
      />
    </Card>
  );
});

interface UploadQueueItemData {
  id: string;
  fileName: string;
  status: string;
  errorMessage?: string;
}

const UploadQueueItem = memo(function UploadQueueItem({
  item,
  onRemove,
}: {
  item: UploadQueueItemData;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const gt = useGT();

  const iconName =
    item.status === 'uploaded'
      ? 'checkmark-circle'
      : item.status === 'failed'
        ? 'alert-circle'
        : item.status === 'uploading'
          ? 'cloud-upload-outline'
          : item.status === 'processing'
            ? 'sparkles-outline'
            : 'time-outline';

  const iconColor =
    item.status === 'uploaded'
      ? theme.primary
      : item.status === 'failed'
        ? theme.danger
        : item.status === 'processing'
          ? theme.accent
          : theme.textTertiary;

  const statusLabel =
    item.status === 'processing'
      ? gt('Wird komprimiert')
      : item.status === 'uploading'
        ? gt('Wird hochgeladen')
        : item.status === 'uploaded'
          ? gt('Fertig')
          : item.status === 'failed'
            ? gt('Fehlgeschlagen')
            : gt('Wartet');

  return (
    <View style={[styles.queueItem, { borderBottomColor: theme.borderLight }]}>
      <View style={styles.queueRow}>
        <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={14} color={iconColor} />
        <View style={styles.queueText}>
          <Text style={[styles.queueFile, { color: theme.text }]} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={[styles.queueStatus, { color: theme.textSecondary }]}>{statusLabel}</Text>
        </View>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={theme.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      {item.status === 'failed' && item.errorMessage ? (
        <Text style={[styles.queueError, { color: theme.danger }]}>{item.errorMessage}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  helper: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    minHeight: 92,
    textAlignVertical: 'top',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  assetRow: {
    gap: Spacing.sm,
  },
  queueList: {
    gap: 2,
  },
  queueItem: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queueText: {
    flex: 1,
    gap: 2,
  },
  queueFile: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  queueStatus: {
    fontSize: FontSize.xs,
  },
  queueError: {
    fontSize: FontSize.xs,
    marginTop: 4,
    marginLeft: 22,
  },
});
