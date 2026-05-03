import assert from 'node:assert/strict';
import test from 'node:test';

import { uploadQueueItemToPreparedAsset, type UploadQueueItem } from './index.ts';

const baseQueueItem: UploadQueueItem = {
  id: 'item-1',
  circleId: 'circle-1',
  shareBatchId: 'share-1',
  kind: 'image',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  fileUri: 'file:///original/photo.jpg',
  previewUri: 'file:///original/photo.jpg',
  status: 'failed',
  attempts: 1,
};

test('rejects retry conversion for queue items that were never prepared', () => {
  assert.throws(
    () => uploadQueueItemToPreparedAsset(baseQueueItem),
    /not been prepared/,
  );
});

test('converts prepared queue items while preserving upload metadata', () => {
  const prepared = uploadQueueItemToPreparedAsset({
    ...baseQueueItem,
    prepared: true,
    fileUri: 'file:///processed/photo.jpg',
    previewUri: 'file:///processed/preview.jpg',
    sizeBytes: 1234,
    width: 800,
    height: 600,
    location: {
      latitude: 52.52,
      longitude: 13.405,
      label: 'Berlin, Germany',
      source: 'embedded',
    },
  });

  assert.deepEqual(prepared, {
    uri: 'file:///processed/photo.jpg',
    previewUri: 'file:///processed/preview.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    kind: 'image',
    sizeBytes: 1234,
    width: 800,
    height: 600,
    durationSeconds: undefined,
    location: {
      latitude: 52.52,
      longitude: 13.405,
      label: 'Berlin, Germany',
      source: 'embedded',
    },
  });
});
