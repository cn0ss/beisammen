import { normalizeBaseUrl, type MediaLocation } from '@beisammen/contracts';
import type { UploadQueueItem } from '@beisammen/upload-client';

export interface UploadRecoveryFileDriver {
  readText(path: string): Promise<string | null>;
  writeText(path: string, value: string): Promise<void>;
  delete(path: string): Promise<void>;
  list?(path: string): Promise<string[]>;
}

export interface UploadRecoveryStore {
  loadQueue(input: UploadRecoveryScope): Promise<UploadQueueItem[]>;
  saveQueue(input: UploadRecoveryScope & { items: UploadQueueItem[] }): Promise<void>;
  clearShareBatch(input: UploadRecoveryScope): Promise<void>;
  clearInstance(input: { instanceUrl: string }): Promise<void>;
  clearItemFiles(item: Pick<UploadQueueItem, 'cacheUri' | 'previewCacheUri'>): Promise<void>;
}

interface UploadRecoveryScope {
  instanceUrl: string;
  shareBatchId: string;
}

const RECOVERY_ROOT = 'upload-recovery';

function instanceKey(instanceUrl: string): string {
  return encodeURIComponent(normalizeBaseUrl(instanceUrl));
}

function metadataPath(input: UploadRecoveryScope): string {
  return `${RECOVERY_ROOT}/${instanceKey(input.instanceUrl)}/${input.shareBatchId}.json`;
}

function instancePath(instanceUrl: string): string {
  return `${RECOVERY_ROOT}/${instanceKey(instanceUrl)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalLocation(value: unknown): MediaLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const latitude = optionalNumber(value.latitude);
  const longitude = optionalNumber(value.longitude);
  const source =
    value.source === 'embedded' || value.source === 'device-fallback'
      ? value.source
      : null;

  if (latitude === undefined || longitude === undefined || !source) {
    return undefined;
  }

  return {
    latitude,
    longitude,
    source,
    ...(optionalNumber(value.accuracyMeters) !== undefined
      ? { accuracyMeters: optionalNumber(value.accuracyMeters) }
      : {}),
    ...(optionalString(value.label) ? { label: optionalString(value.label) } : {}),
    ...(optionalString(value.city) ? { city: optionalString(value.city) } : {}),
    ...(optionalString(value.region) ? { region: optionalString(value.region) } : {}),
    ...(optionalString(value.country) ? { country: optionalString(value.country) } : {}),
  };
}

function isRecoverableItem(item: UploadQueueItem): boolean {
  return item.recoverable === true && Boolean(item.cacheUri) && item.status !== 'uploaded';
}

function serializeItem(item: UploadQueueItem): UploadQueueItem | null {
  if (!isRecoverableItem(item)) {
    return null;
  }

  const { sourceAsset: _sourceAsset, ...serialized } = item;
  return serialized;
}

function parseItem(value: unknown): UploadQueueItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = optionalString(value.id);
  const circleId = optionalString(value.circleId);
  const shareBatchId = optionalString(value.shareBatchId);
  const kind = value.kind === 'image' || value.kind === 'video' ? value.kind : null;
  const fileName = optionalString(value.fileName);
  const mimeType = optionalString(value.mimeType);
  const fileUri = optionalString(value.fileUri);
  const createdAt = optionalNumber(value.createdAt);
  const updatedAt = optionalNumber(value.updatedAt);
  const sizeBytes = optionalNumber(value.sizeBytes);
  const width = optionalNumber(value.width);
  const height = optionalNumber(value.height);
  const durationSeconds = optionalNumber(value.durationSeconds);
  const capturedAt = optionalNumber(value.capturedAt);
  const location = optionalLocation(value.location);
  const status =
    value.status === 'draft' ||
    value.status === 'processing' ||
    value.status === 'uploading' ||
    value.status === 'uploaded' ||
    value.status === 'failed'
      ? value.status
      : null;

  if (!id || !circleId || !shareBatchId || !kind || !fileName || !mimeType || !fileUri || !status) {
    return null;
  }

  const item: UploadQueueItem = {
    id,
    circleId,
    shareBatchId,
    kind,
    fileName,
    mimeType,
    fileUri,
    status,
    attempts: optionalNumber(value.attempts) ?? 0,
    ...(optionalString(value.uploadId) ? { uploadId: optionalString(value.uploadId) } : {}),
    ...(value.prepared === true ? { prepared: true } : {}),
    ...(optionalString(value.cacheUri) ? { cacheUri: optionalString(value.cacheUri) } : {}),
    ...(optionalString(value.previewCacheUri)
      ? { previewCacheUri: optionalString(value.previewCacheUri) }
      : {}),
    ...(optionalString(value.recoveryKey) ? { recoveryKey: optionalString(value.recoveryKey) } : {}),
    ...(value.recoverable === true ? { recoverable: true } : { recoverable: false }),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(optionalString(value.previewUri) ? { previewUri: optionalString(value.previewUri) } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
    ...(location ? { location } : {}),
    ...(optionalString(value.locationLabel) ? { locationLabel: optionalString(value.locationLabel) } : {}),
    ...(optionalString(value.errorMessage) ? { errorMessage: optionalString(value.errorMessage) } : {}),
  };

  if (!isRecoverableItem(item)) {
    return null;
  }

  return item;
}

function uniqueUris(item: Pick<UploadQueueItem, 'cacheUri' | 'previewCacheUri'>): string[] {
  return Array.from(
    new Set([item.cacheUri, item.previewCacheUri].filter((uri): uri is string => Boolean(uri))),
  );
}

export function createUploadRecoveryStore(driver: UploadRecoveryFileDriver): UploadRecoveryStore {
  return {
    async loadQueue(input) {
      const raw = await driver.readText(metadataPath(input));

      if (!raw) {
        return [];
      }

      let payload: unknown;

      try {
        payload = JSON.parse(raw);
      } catch {
        return [];
      }

      if (!isRecord(payload) || !Array.isArray(payload.items)) {
        return [];
      }

      return payload.items
        .map((item) => parseItem(item))
        .filter((item): item is UploadQueueItem => item !== null);
    },

    async saveQueue(input) {
      const items = input.items
        .map((item) => serializeItem(item))
        .filter((item): item is UploadQueueItem => item !== null);
      const path = metadataPath(input);

      if (items.length === 0) {
        await driver.delete(path);
        return;
      }

      await driver.writeText(path, JSON.stringify({ items }, null, 2));
    },

    async clearShareBatch(input) {
      const items = await this.loadQueue(input);

      for (const item of items) {
        await this.clearItemFiles(item);
      }

      await driver.delete(metadataPath(input));
    },

    async clearInstance(input) {
      const path = instancePath(input.instanceUrl);

      if (driver.list) {
        const entries = await driver.list(path);

        for (const entry of entries) {
          if (!entry.endsWith('.json')) {
            continue;
          }

          const raw = await driver.readText(entry);

          if (!raw) {
            continue;
          }

          let payload: unknown;

          try {
            payload = JSON.parse(raw);
          } catch {
            continue;
          }

          if (!isRecord(payload) || !Array.isArray(payload.items)) {
            continue;
          }

          for (const item of payload.items) {
            const parsed = parseItem(item);

            if (parsed) {
              await this.clearItemFiles(parsed);
            }
          }
        }
      }

      await driver.delete(path);
    },

    async clearItemFiles(item) {
      for (const uri of uniqueUris(item)) {
        await driver.delete(uri);
      }
    },
  };
}
