import {
  SUPPORTED_IMAGE_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
  type AssetKind,
  type MediaLocation,
  type UploadStatus,
} from '@beisammen/contracts';

const supportedImageMimeTypes: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME_TYPES);
const supportedVideoMimeTypes: ReadonlySet<string> = new Set(SUPPORTED_VIDEO_MIME_TYPES);

export interface PreparedUploadQueueAsset {
  uri: string;
  previewUri: string;
  fileName: string;
  mimeType: string;
  kind: AssetKind;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
  capturedAt?: number;
  /** Live Photo companion clip (image assets only). */
  pairedVideoUri?: string;
  pairedVideoMimeType?: string;
  pairedVideoSizeBytes?: number;
  pairedVideoDurationSeconds?: number;
}

export function assertPreparedUploadAssetMimeTypeSupported(
  asset: Pick<PreparedUploadQueueAsset, 'kind' | 'mimeType' | 'fileName'>,
): void {
  const mimeType = asset.mimeType.trim().toLowerCase();
  const supportedMimeTypes =
    asset.kind === 'image' ? supportedImageMimeTypes : supportedVideoMimeTypes;

  if (!supportedMimeTypes.has(mimeType)) {
    throw new Error(`Der Dateityp von ${asset.fileName} wird in der Beta noch nicht unterstützt.`);
  }
}

/**
 * Server-safe E2EE envelope for an upload, mirroring `assets.encryption`.
 * wrappedFileKey and encMetadata are ciphertext by definition, so persisting
 * this for retries is safe — raw key material must never be stored here.
 */
export interface UploadEncryptionEnvelope {
  v: 1;
  circleEpoch: number;
  wrappedFileKey: string;
  encMetadata?: string;
}

export interface UploadQueueItem<SourceAsset = unknown> {
  id: string;
  circleId: string;
  shareBatchId: string;
  uploadId?: string;
  sourceAsset?: SourceAsset;
  prepared?: boolean;
  cacheUri?: string;
  previewCacheUri?: string;
  /**
   * Ciphertext files and sealed envelope from the first attempt. Retries must
   * reuse them byte-identically: presigned PUTs are re-signed for the exact
   * originally declared sizes.
   */
  encryptedCacheUri?: string;
  encryptedPreviewCacheUri?: string;
  encryptedPairedVideoCacheUri?: string;
  encryption?: UploadEncryptionEnvelope;
  recoveryKey?: string;
  recoverable?: boolean;
  createdAt?: number;
  updatedAt?: number;
  kind: AssetKind;
  fileName: string;
  mimeType: string;
  fileUri: string;
  previewUri?: string;
  sizeBytes?: number;
  /** Byte size of the generated preview, declared to the server at createTarget. */
  previewSizeBytes?: number;
  /** Live Photo companion clip; the cache URI mirrors `cacheUri` for retries. */
  pairedVideoUri?: string;
  pairedVideoCacheUri?: string;
  pairedVideoMimeType?: string;
  pairedVideoSizeBytes?: number;
  pairedVideoDurationSeconds?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
  capturedAt?: number;
  locationLabel?: string;
  bytesSent?: number;
  totalBytesExpectedToSend?: number;
  progressRatio?: number;
  status: UploadStatus;
  attempts: number;
  errorMessage?: string;
}

export interface UploadQueueState<SourceAsset = unknown> {
  items: UploadQueueItem<SourceAsset>[];
}

export const initialUploadQueueState: UploadQueueState<never> = {
  items: [],
};

function withRecoveryDefaults<SourceAsset>(
  item: UploadQueueItem<SourceAsset>,
): UploadQueueItem<SourceAsset> {
  const timestamp = Date.now();

  return {
    ...item,
    recoverable: item.recoverable ?? false,
    createdAt: item.createdAt ?? timestamp,
    updatedAt: item.updatedAt ?? item.createdAt ?? timestamp,
  };
}

export function enqueue<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
  item: UploadQueueItem<SourceAsset>,
): UploadQueueState<SourceAsset> {
  return {
    items: [...state.items, withRecoveryDefaults(item)],
  };
}

export function markUploadStatus<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
  itemId: string,
  status: UploadStatus,
  errorMessage?: string,
): UploadQueueState<SourceAsset> {
  return {
    items: state.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status,
            errorMessage: status === 'processing' || status === 'uploading' ? undefined : errorMessage,
            attempts: status === 'failed' ? item.attempts + 1 : item.attempts,
            ...(status === 'failed' || status === 'processing'
              ? {
                  bytesSent: undefined,
                  totalBytesExpectedToSend: undefined,
                  progressRatio: undefined,
                }
              : {}),
            updatedAt: Date.now(),
          }
        : item,
    ),
  };
}

export function patchUploadProgress<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
  itemId: string,
  progress: {
    bytesSent: number;
    totalBytesExpectedToSend?: number;
  },
): UploadQueueState<SourceAsset> {
  const bytesSent = Math.max(0, Math.floor(progress.bytesSent));
  const totalBytesExpectedToSend =
    progress.totalBytesExpectedToSend !== undefined &&
    Number.isFinite(progress.totalBytesExpectedToSend) &&
    progress.totalBytesExpectedToSend > 0
      ? Math.floor(progress.totalBytesExpectedToSend)
      : undefined;
  const progressRatio = totalBytesExpectedToSend
    ? Math.min(1, Math.max(0, bytesSent / totalBytesExpectedToSend))
    : undefined;

  return {
    items: state.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            bytesSent,
            totalBytesExpectedToSend,
            progressRatio,
            updatedAt: Date.now(),
          }
        : item,
    ),
  };
}

export function patchUploadQueueItem<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
  itemId: string,
  patch: Partial<UploadQueueItem<SourceAsset>>,
): UploadQueueState<SourceAsset> {
  return {
    items: state.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...patch,
            updatedAt: patch.updatedAt ?? Date.now(),
          }
        : item,
    ),
  };
}

export function uploadQueueItemToPreparedAsset(
  item: UploadQueueItem,
): PreparedUploadQueueAsset {
  if (!item.prepared) {
    throw new Error('Upload queue item has not been prepared.');
  }

  return {
    uri: item.cacheUri ?? item.fileUri,
    previewUri: item.previewCacheUri ?? item.previewUri ?? item.cacheUri ?? item.fileUri,
    fileName: item.fileName,
    mimeType: item.mimeType,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    width: item.width,
    height: item.height,
    durationSeconds: item.durationSeconds,
    location: item.location,
    capturedAt: item.capturedAt,
    ...(item.pairedVideoCacheUri ?? item.pairedVideoUri
      ? {
          pairedVideoUri: item.pairedVideoCacheUri ?? item.pairedVideoUri,
          pairedVideoMimeType: item.pairedVideoMimeType,
          pairedVideoSizeBytes: item.pairedVideoSizeBytes,
          pairedVideoDurationSeconds: item.pairedVideoDurationSeconds,
        }
      : {}),
  };
}

export function removeUploadQueueItems<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
  predicate: (item: UploadQueueItem<SourceAsset>) => boolean,
): UploadQueueState<SourceAsset> {
  return {
    items: state.items.filter((item) => !predicate(item)),
  };
}
