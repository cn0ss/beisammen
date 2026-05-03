import type { AssetKind, MediaLocation, UploadStatus } from '@beisammen/contracts';

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
}

export interface UploadQueueItem<SourceAsset = unknown> {
  id: string;
  circleId: string;
  shareBatchId: string;
  uploadId?: string;
  sourceAsset?: SourceAsset;
  prepared?: boolean;
  kind: AssetKind;
  fileName: string;
  mimeType: string;
  fileUri: string;
  previewUri?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
  locationLabel?: string;
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

export function enqueue<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
  item: UploadQueueItem<SourceAsset>,
): UploadQueueState<SourceAsset> {
  return {
    items: [...state.items, item],
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
            errorMessage,
            attempts: status === 'failed' ? item.attempts + 1 : item.attempts,
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
    uri: item.fileUri,
    previewUri: item.previewUri ?? item.fileUri,
    fileName: item.fileName,
    mimeType: item.mimeType,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    width: item.width,
    height: item.height,
    durationSeconds: item.durationSeconds,
    location: item.location,
  };
}

export function clearCompleted<SourceAsset>(
  state: UploadQueueState<SourceAsset>,
): UploadQueueState<SourceAsset> {
  return {
    items: state.items.filter((item) => item.status !== 'uploaded'),
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
