import type { AssetKind, UploadStatus } from '@beisammen/contracts';

export interface UploadQueueItem {
  id: string;
  circleId: string;
  shareBatchId: string;
  uploadId?: string;
  kind: AssetKind;
  fileName: string;
  mimeType: string;
  fileUri: string;
  previewUri?: string;
  locationLabel?: string;
  status: UploadStatus;
  attempts: number;
  errorMessage?: string;
}

export interface UploadQueueState {
  items: UploadQueueItem[];
}

export const initialUploadQueueState: UploadQueueState = {
  items: [],
};

export function enqueue(
  state: UploadQueueState,
  item: UploadQueueItem,
): UploadQueueState {
  return {
    items: [...state.items, item],
  };
}

export function markUploadStatus(
  state: UploadQueueState,
  itemId: string,
  status: UploadStatus,
  errorMessage?: string,
): UploadQueueState {
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

export function patchUploadQueueItem(
  state: UploadQueueState,
  itemId: string,
  patch: Partial<UploadQueueItem>,
): UploadQueueState {
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

export function clearCompleted(state: UploadQueueState): UploadQueueState {
  return {
    items: state.items.filter((item) => item.status !== 'uploaded'),
  };
}

export function removeUploadQueueItems(
  state: UploadQueueState,
  predicate: (item: UploadQueueItem) => boolean,
): UploadQueueState {
  return {
    items: state.items.filter((item) => !predicate(item)),
  };
}
