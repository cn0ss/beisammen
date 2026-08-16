import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAction, useMutation } from 'convex/react';

import {
  assertUploadBatchWithinBetaLimits,
  enqueue,
  initialUploadQueueState,
  markUploadStatus,
  patchUploadProgress,
  patchUploadQueueItem,
  removeUploadQueueItems,
  uploadQueueItemToPreparedAsset,
  type UploadQueueItem,
  type UploadQueueState,
} from '@beisammen/upload-client';

import type { CircleListItem, ShareDraftRecord } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { recordClientDiagnostic } from '@/features/diagnostics/buffer';
import { createLogger } from '@/lib/logger';

import {
  assetKind,
  createCompressedPreview,
  fileNameFromPickerAsset,
  formatMediaLocation,
  mimeTypeForPickerAsset,
  optimizePickerAsset,
  resolvePickerAssetMetadata,
  uploadPreparedFile,
  type PreparedUploadAsset,
} from './client';
import {
  assertPreparedAssetAllowedForDeployment,
  isCloudDeployment,
  mediaSelectionLimitForDeployment,
} from './upload-policy';
import {
  cacheUploadRecoveryFile,
  clearUploadRecoveryItemFiles,
  uploadRecoveryStore,
} from './upload-recovery-runtime';

const logger = createLogger('media.shareUpload');

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface UseShareUploadFlowArgs {
  selectedCircle: CircleListItem | null;
  activeDraft?: ShareDraftRecord | null;
  existingDraftAssetCount: number;
  onFeedback: (message: string | null) => void;
}

export function useShareUploadFlow({
  activeDraft,
  selectedCircle,
  existingDraftAssetCount,
  onFeedback,
}: UseShareUploadFlowArgs) {
  const getOrCreateDraft = useMutation(api.shares.getOrCreateDraft);
  const createTarget = useAction(api.uploads.createTarget);
  const retryUpload = useAction(api.uploads.retry);
  const completeUpload = useAction(api.uploads.complete);
  const discardUpload = useAction(api.uploads.discard);
  const { instance } = useSession();
  const instanceUrl = instance.instance.baseUrl;

  const [uploadQueue, setUploadQueue] =
    useState<UploadQueueState<ImagePicker.ImagePickerAsset>>(initialUploadQueueState);
  const [isUploading, setIsUploading] = useState(false);
  const deploymentKind = instance.deployment.kind;
  const isCloud = isCloudDeployment(deploymentKind);
  const hydratedDraftKeysRef = useRef<Set<string>>(new Set());
  const persistedShareBatchIdsRef = useRef<Set<string>>(new Set());

  const selectedQueueItems = useMemo(
    () =>
      selectedCircle
        ? uploadQueue.items.filter((item) => item.circleId === selectedCircle._id)
        : [],
    [selectedCircle, uploadQueue.items],
  );

  const hasUnresolvedUploads = selectedQueueItems.length > 0;

  useEffect(() => {
    hydratedDraftKeysRef.current.clear();
    persistedShareBatchIdsRef.current.clear();
    setUploadQueue(initialUploadQueueState);
  }, [instanceUrl]);

  useEffect(() => {
    if (!selectedCircle || !activeDraft?._id) {
      return;
    }

    const draftKey = `${instanceUrl}:${activeDraft._id}`;

    if (hydratedDraftKeysRef.current.has(draftKey)) {
      return;
    }

    hydratedDraftKeysRef.current.add(draftKey);
    let isCancelled = false;

    void uploadRecoveryStore
      .loadQueue({
        instanceUrl,
        shareBatchId: activeDraft._id,
      })
      .then((items) => {
        if (isCancelled || items.length === 0) {
          return;
        }

        setUploadQueue((state) => {
          const existingIds = new Set(state.items.map((item) => item.id));
          const restoredItems = items.filter(
            (item): item is UploadQueueItem<ImagePicker.ImagePickerAsset> =>
              item.circleId === selectedCircle._id &&
              item.shareBatchId === activeDraft._id &&
              !existingIds.has(item.id),
          );

          if (restoredItems.length === 0) {
            return state;
          }

          return {
            items: [...state.items, ...restoredItems],
          };
        });
      })
      .catch((error) => {
        logger.warn('Upload recovery hydration failed', {
          instanceUrl,
          shareBatchId: activeDraft._id,
          error,
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [activeDraft?._id, instanceUrl, selectedCircle]);

  useEffect(() => {
    const grouped = new Map<string, UploadQueueItem<ImagePicker.ImagePickerAsset>[]>();

    for (const item of uploadQueue.items) {
      if (!item.recoverable || !item.cacheUri || item.status === 'uploaded') {
        continue;
      }

      const items = grouped.get(item.shareBatchId) ?? [];
      items.push(item);
      grouped.set(item.shareBatchId, items);
    }

    for (const [shareBatchId, items] of grouped) {
      void uploadRecoveryStore
        .saveQueue({
          instanceUrl,
          shareBatchId,
          items,
        })
        .catch((error) => {
          logger.warn('Upload recovery persistence failed', {
            instanceUrl,
            shareBatchId,
            error,
          });
        });
    }

    for (const shareBatchId of persistedShareBatchIdsRef.current) {
      if (grouped.has(shareBatchId)) {
        continue;
      }

      void uploadRecoveryStore
        .saveQueue({
          instanceUrl,
          shareBatchId,
          items: [],
        })
        .catch((error) => {
          logger.warn('Upload recovery metadata cleanup failed', {
            instanceUrl,
            shareBatchId,
            error,
          });
        });
    }

    persistedShareBatchIdsRef.current = new Set(grouped.keys());
  }, [instanceUrl, uploadQueue.items]);

  const uploadPreparedAsset = useCallback(
    async (input: {
      queueId: string;
      circleId: string;
      shareBatchId: string;
      preparedAsset: PreparedUploadAsset;
      uploadId?: string;
      cacheUri?: string;
      previewCacheUri?: string;
    }) => {
      assertPreparedAssetAllowedForDeployment({
        deploymentKind,
        asset: input.preparedAsset,
      });

      const prepared = input.uploadId
        ? await retryUpload({ uploadId: input.uploadId })
        : await createTarget({
            circleId: input.circleId,
            shareBatchId: input.shareBatchId,
            kind: input.preparedAsset.kind,
            mimeType: input.preparedAsset.mimeType,
            fileName: input.preparedAsset.fileName,
          });

      setUploadQueue((state) =>
        patchUploadQueueItem(state, input.queueId, {
          uploadId: prepared.uploadId,
        }),
      );
      setUploadQueue((state) => markUploadStatus(state, input.queueId, 'uploading'));

      const uploaded = await uploadPreparedFile({
        target: prepared.target,
        asset: input.preparedAsset,
        onProgress: (progress) => {
          setUploadQueue((state) => patchUploadProgress(state, input.queueId, progress));
        },
      });
      let previewCacheUri = input.previewCacheUri;
      let previewUploaded: {
        previewStorageId?: string;
        previewObjectKey?: string;
      } = {};

      if (prepared.previewTarget) {
        const previewAsset = await createCompressedPreview({
          uri: input.preparedAsset.previewUri,
          kind: input.preparedAsset.kind,
        });

        setUploadQueue((state) =>
          patchUploadQueueItem(state, input.queueId, {
            previewUri: previewAsset.uri,
            previewCacheUri: previewAsset.uri,
          }),
        );
        previewCacheUri = previewAsset.uri;

        const uploadedPreview = await uploadPreparedFile({
          target: prepared.previewTarget,
          asset: {
            ...input.preparedAsset,
            uri: previewAsset.uri,
            mimeType: previewAsset.mimeType,
            sizeBytes: previewAsset.sizeBytes,
            width: previewAsset.width ?? input.preparedAsset.width,
            height: previewAsset.height ?? input.preparedAsset.height,
          },
        });

        previewUploaded = {
          ...(uploadedPreview.storageId ? { previewStorageId: uploadedPreview.storageId } : {}),
          ...(uploadedPreview.objectKey ? { previewObjectKey: uploadedPreview.objectKey } : {}),
        };
      }

      await completeUpload({
        uploadId: prepared.uploadId,
        ...(uploaded.storageId ? { storageId: uploaded.storageId } : {}),
        ...(uploaded.objectKey ? { objectKey: uploaded.objectKey } : {}),
        ...previewUploaded,
        fileName: input.preparedAsset.fileName,
        sizeBytes: input.preparedAsset.sizeBytes,
        width: input.preparedAsset.width,
        height: input.preparedAsset.height,
        durationSeconds: input.preparedAsset.durationSeconds,
        location: input.preparedAsset.location,
        capturedAt: input.preparedAsset.capturedAt,
      });

      await uploadRecoveryStore.clearItemFiles({
        cacheUri: input.cacheUri,
        previewCacheUri,
      });
    },
    [completeUpload, createTarget, deploymentKind, retryUpload],
  );

  const handlePickMedia = useCallback(async () => {
    if (!selectedCircle) {
      onFeedback('Bitte wähle zuerst einen Circle aus.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onFeedback('Ohne Mediathek-Zugriff können keine Fotos oder Videos ausgewählt werden.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      exif: true,
      quality: 1,
      selectionLimit: mediaSelectionLimitForDeployment(deploymentKind),
    });

    if (result.canceled || !result.assets.length) return;

    if (isCloud) {
      try {
        assertUploadBatchWithinBetaLimits({
          selectedCount: result.assets.length,
          existingDraftAssetCount,
          existingPendingCount: selectedQueueItems.length,
        });
      } catch (error) {
        onFeedback(errorMessage(error, 'Zu viele Medien ausgewählt.'));
        return;
      }
    }

    onFeedback(null);
    setIsUploading(true);

    try {
      const draft = await getOrCreateDraft({ circleId: selectedCircle._id });
      const resolvedMetadata = await resolvePickerAssetMetadata(result.assets);

      let successCount = 0;

      for (const [index, asset] of result.assets.entries()) {
        const assetMetadata = resolvedMetadata[index] ?? {};
        const resolvedLocation = assetMetadata.location;
        const capturedAt = assetMetadata.capturedAt;
        const fileName = fileNameFromPickerAsset(asset);
        const mimeType = mimeTypeForPickerAsset(asset);
        const kind = assetKind(asset);
        const queueId = `${draft.shareBatchId}:${asset.assetId ?? asset.uri}:${index}:${Date.now()}`;
        let cacheUri: string | null = null;

        try {
          cacheUri = await cacheUploadRecoveryFile({
            instanceUrl,
            shareBatchId: draft.shareBatchId,
            queueId,
            uri: asset.uri,
            fileName,
          });
        } catch (error) {
          logger.warn('Upload recovery file cache failed', {
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            fileName,
            error,
          });
        }

        const uploadUri = cacheUri ?? asset.uri;
        const uploadAsset = cacheUri ? { ...asset, uri: cacheUri } : asset;
        const durationSeconds =
          asset.duration !== null && asset.duration !== undefined
            ? asset.duration / 1000
            : undefined;

        setUploadQueue((state) =>
          enqueue(state, {
            id: queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            sourceAsset: asset,
            kind,
            fileName,
            mimeType,
            fileUri: uploadUri,
            previewUri: uploadUri,
            ...(cacheUri ? { cacheUri } : {}),
            recoverable: Boolean(cacheUri),
            prepared: Boolean(cacheUri),
            sizeBytes: asset.fileSize ?? undefined,
            width: asset.width,
            height: asset.height,
            durationSeconds,
            location: resolvedLocation,
            capturedAt,
            locationLabel: formatMediaLocation(resolvedLocation) ?? undefined,
            status: 'processing',
            attempts: 0,
          }),
        );

        try {
          const preparedAsset = await optimizePickerAsset(uploadAsset, resolvedLocation, capturedAt);

          assertPreparedAssetAllowedForDeployment({
            deploymentKind,
            asset: preparedAsset,
          });

          setUploadQueue((state) =>
            patchUploadQueueItem(state, queueId, {
              fileUri: preparedAsset.uri,
              previewUri: preparedAsset.previewUri,
              kind: preparedAsset.kind,
              fileName: preparedAsset.fileName,
              mimeType: preparedAsset.mimeType,
              sizeBytes: preparedAsset.sizeBytes,
              width: preparedAsset.width,
              height: preparedAsset.height,
              durationSeconds: preparedAsset.durationSeconds,
              location: preparedAsset.location,
              capturedAt: preparedAsset.capturedAt,
              locationLabel: formatMediaLocation(preparedAsset.location) ?? undefined,
              prepared: true,
            }),
          );

          await uploadPreparedAsset({
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            preparedAsset,
            ...(cacheUri ? { cacheUri } : {}),
          });

          successCount += 1;
          setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === queueId));
        } catch (error) {
          const message = errorMessage(error, 'Upload fehlgeschlagen.');
          logger.warn('Upload item failed', {
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            fileName,
            errorMessage: message,
            error,
          });
          recordClientDiagnostic('upload', 'Upload item failed', {
            queueId,
            circleId: selectedCircle._id,
            shareBatchId: draft.shareBatchId,
            fileName,
            errorMessage: message,
            error,
          });
          setUploadQueue((state) => markUploadStatus(state, queueId, 'failed', message));
        }
      }

      if (successCount > 0) {
        onFeedback(
          successCount === result.assets.length
            ? 'Medien wurden zum Entwurf hinzugefügt.'
            : `${successCount} von ${result.assets.length} Medien wurden zum Entwurf hinzugefügt.`,
        );
      } else {
        onFeedback('Kein Asset konnte hochgeladen werden.');
      }
    } catch (error) {
      logger.error('Media selection upload failed', {
        circleId: selectedCircle._id,
        error,
      });
      recordClientDiagnostic('upload', 'Media selection upload failed', {
        circleId: selectedCircle._id,
        error,
      });
      onFeedback(errorMessage(error, 'Medien konnten nicht hinzugefügt werden.'));
    } finally {
      setIsUploading(false);
    }
  }, [
    getOrCreateDraft,
    existingDraftAssetCount,
    deploymentKind,
    instanceUrl,
    isCloud,
    onFeedback,
    selectedCircle,
    selectedQueueItems.length,
    uploadPreparedAsset,
  ]);

  const handleRetryFailedUpload = useCallback(
    async (itemId: string) => {
      const queueItem = uploadQueue.items.find((item) => item.id === itemId);

      if (!queueItem) {
        return;
      }

      onFeedback(null);
      setIsUploading(true);
      setUploadQueue((state) => markUploadStatus(state, itemId, 'processing'));

      try {
        let preparedAsset: PreparedUploadAsset;

        if (queueItem.prepared || !queueItem.sourceAsset) {
          preparedAsset = uploadQueueItemToPreparedAsset(queueItem);
        } else {
          preparedAsset = await optimizePickerAsset(
            queueItem.sourceAsset,
            queueItem.location,
            queueItem.capturedAt,
          );
          assertPreparedAssetAllowedForDeployment({
            deploymentKind,
            asset: preparedAsset,
          });

          setUploadQueue((state) =>
            patchUploadQueueItem(state, itemId, {
              fileUri: preparedAsset.uri,
              previewUri: preparedAsset.previewUri,
              kind: preparedAsset.kind,
              fileName: preparedAsset.fileName,
              mimeType: preparedAsset.mimeType,
              sizeBytes: preparedAsset.sizeBytes,
              width: preparedAsset.width,
              height: preparedAsset.height,
              durationSeconds: preparedAsset.durationSeconds,
              location: preparedAsset.location,
              capturedAt: preparedAsset.capturedAt,
              locationLabel: formatMediaLocation(preparedAsset.location) ?? undefined,
              prepared: true,
            }),
          );
        }

        await uploadPreparedAsset({
          queueId: itemId,
          circleId: queueItem.circleId,
          shareBatchId: queueItem.shareBatchId,
          preparedAsset,
          uploadId: queueItem.uploadId,
          cacheUri: queueItem.cacheUri,
          previewCacheUri: queueItem.previewCacheUri,
        });

        setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === itemId));
        onFeedback('Upload wurde abgeschlossen.');
      } catch (error) {
        const message = errorMessage(error, 'Upload fehlgeschlagen.');
        logger.warn('Upload retry failed', {
          itemId,
          circleId: queueItem.circleId,
          shareBatchId: queueItem.shareBatchId,
          fileName: queueItem.fileName,
          error,
        });
        recordClientDiagnostic('upload', 'Upload retry failed', {
          itemId,
          circleId: queueItem.circleId,
          shareBatchId: queueItem.shareBatchId,
          fileName: queueItem.fileName,
          error,
        });
        setUploadQueue((state) => markUploadStatus(state, itemId, 'failed', message));
        onFeedback(message);
      } finally {
        setIsUploading(false);
      }
    },
    [deploymentKind, onFeedback, uploadPreparedAsset, uploadQueue.items],
  );

  const handleRemoveFailedUpload = useCallback(
    async (itemId: string) => {
      const queueItem = uploadQueue.items.find((item) => item.id === itemId);

      if (!queueItem) {
        return;
      }

      if (queueItem.uploadId) {
        try {
          await discardUpload({
            uploadId: queueItem.uploadId,
          });
        } catch (error) {
          logger.warn('Discard failed upload failed', {
            itemId,
            uploadId: queueItem.uploadId,
            error,
          });
          onFeedback(errorMessage(error, 'Fehlgeschlagener Upload konnte nicht entfernt werden.'));
          return;
        }
      }

      await clearUploadRecoveryItemFiles(queueItem);
      setUploadQueue((state) => removeUploadQueueItems(state, (item) => item.id === itemId));
    },
    [discardUpload, onFeedback, uploadQueue.items],
  );

  const handleDiscardUpload = useCallback(
    async (uploadId: string) => {
      const matchingItems = uploadQueue.items.filter((item) => item.uploadId === uploadId);

      await discardUpload({
        uploadId,
      });
      await Promise.all(matchingItems.map((item) => clearUploadRecoveryItemFiles(item)));
      setUploadQueue((state) =>
        removeUploadQueueItems(state, (item) => item.uploadId === uploadId),
      );
    },
    [discardUpload, uploadQueue.items],
  );

  const removeItemsForShareBatch = useCallback((shareBatchId: string) => {
    void uploadRecoveryStore
      .clearShareBatch({
        instanceUrl,
        shareBatchId,
      })
      .catch((error) => {
        logger.warn('Upload recovery share cleanup failed', {
          instanceUrl,
          shareBatchId,
          error,
        });
      });
    setUploadQueue((state) =>
      removeUploadQueueItems(state, (item) => item.shareBatchId === shareBatchId),
    );
  }, [instanceUrl]);

  return {
    uploadQueue,
    selectedQueueItems,
    hasUnresolvedUploads,
    isUploading,
    handlePickMedia,
    handleRetryFailedUpload,
    handleRemoveFailedUpload,
    handleDiscardUpload,
    removeItemsForShareBatch,
  };
}
