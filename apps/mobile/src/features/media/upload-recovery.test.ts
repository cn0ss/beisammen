import { describe, expect, test } from 'vitest';

import type { UploadQueueItem } from '@beisammen/upload-client';

import {
  createUploadRecoveryStore,
  type UploadRecoveryFileDriver,
} from './upload-recovery';

function recoverableItem(patch: Partial<UploadQueueItem> = {}): UploadQueueItem {
  return {
    id: 'item-1',
    circleId: 'circle-1',
    shareBatchId: 'share-1',
    uploadId: 'upload-1',
    kind: 'image',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    fileUri: 'file:///cache/photo.jpg',
    previewUri: 'file:///cache/photo.jpg',
    cacheUri: 'file:///cache/photo.jpg',
    status: 'failed',
    attempts: 1,
    prepared: true,
    recoverable: true,
    createdAt: 1,
    updatedAt: 2,
    capturedAt: Date.parse('2026-04-18T09:30:00.000Z'),
    ...patch,
  };
}

function createMemoryDriver(): UploadRecoveryFileDriver & {
  files: Map<string, string>;
  deletedUris: string[];
} {
  const files = new Map<string, string>();
  const deletedUris: string[] = [];

  return {
    files,
    deletedUris,
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, value) {
      files.set(path, value);
    },
    async delete(path) {
      deletedUris.push(path);
      files.delete(path);
    },
  };
}

describe('upload recovery store', () => {
  test('persists and hydrates only recoverable items for the same instance and draft', async () => {
    const driver = createMemoryDriver();
    const store = createUploadRecoveryStore(driver);
    const recoverable = recoverableItem();
    const discardOnly = recoverableItem({
      id: 'item-2',
      uploadId: 'upload-2',
      cacheUri: undefined,
      recoverable: false,
    });

    await store.saveQueue({
      instanceUrl: 'https://one.example.com/',
      shareBatchId: 'share-1',
      items: [recoverable, discardOnly],
    });
    await store.saveQueue({
      instanceUrl: 'https://two.example.com',
      shareBatchId: 'share-1',
      items: [recoverableItem({ id: 'other-instance' })],
    });

    await expect(
      store.loadQueue({
        instanceUrl: 'https://one.example.com',
        shareBatchId: 'share-1',
      }),
    ).resolves.toEqual([recoverable]);
  });

  test('clears cached files and persisted metadata for a share batch', async () => {
    const driver = createMemoryDriver();
    const store = createUploadRecoveryStore(driver);

    await store.saveQueue({
      instanceUrl: 'https://one.example.com',
      shareBatchId: 'share-1',
      items: [
        recoverableItem({
          cacheUri: 'file:///cache/original.jpg',
          previewCacheUri: 'file:///cache/preview.jpg',
        }),
      ],
    });

    await store.clearShareBatch({
      instanceUrl: 'https://one.example.com',
      shareBatchId: 'share-1',
    });

    expect(driver.deletedUris).toEqual([
      'file:///cache/original.jpg',
      'file:///cache/preview.jpg',
      'upload-recovery/https%3A%2F%2Fone.example.com/share-1.json',
    ]);
  });
});
