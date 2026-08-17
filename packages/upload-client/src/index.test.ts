import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  assertPreparedUploadAssetMimeTypeSupported,
  enqueue,
  clearCompleted,
  initialUploadQueueState,
  markUploadStatus,
  patchUploadProgress,
  uploadQueueItemToPreparedAsset,
  type UploadQueueItem,
} from './index.ts';

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-05T08:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('rejects retry conversion for queue items that were never prepared', () => {
  expect(() => uploadQueueItemToPreparedAsset(baseQueueItem)).toThrow(
    /not been prepared/,
  );
});

test('converts prepared queue items while preserving upload metadata', () => {
  const capturedAt = Date.parse('2026-04-18T09:30:00.000Z');
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
    capturedAt,
  });

  expect(prepared).toEqual({
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
    capturedAt,
  });
});

test('enqueues upload items with recovery metadata defaults', () => {
  const state = enqueue(initialUploadQueueState, {
    ...baseQueueItem,
    status: 'processing',
    attempts: 0,
  });

  expect(state.items[0]).toMatchObject({
    createdAt: Date.parse('2026-05-05T08:00:00.000Z'),
    updatedAt: Date.parse('2026-05-05T08:00:00.000Z'),
    recoverable: false,
  });
});

test('status changes refresh recovery update time while preserving created time', () => {
  const createdAt = Date.parse('2026-05-05T08:00:00.000Z');
  const initial = enqueue(initialUploadQueueState, {
    ...baseQueueItem,
    status: 'processing',
    attempts: 0,
  });

  vi.setSystemTime(new Date('2026-05-05T08:01:00.000Z'));

  const next = markUploadStatus(initial, 'item-1', 'failed', 'network');

  expect(next.items[0]).toMatchObject({
    createdAt,
    updatedAt: Date.parse('2026-05-05T08:01:00.000Z'),
    attempts: 1,
    errorMessage: 'network',
  });
});

test('patches upload progress with a bounded ratio', () => {
  const initial = enqueue(initialUploadQueueState, {
    ...baseQueueItem,
    status: 'uploading',
    attempts: 0,
  });

  const next = patchUploadProgress(initial, 'item-1', {
    bytesSent: 512,
    totalBytesExpectedToSend: 1024,
  });

  expect(next.items[0]).toMatchObject({
    bytesSent: 512,
    totalBytesExpectedToSend: 1024,
    progressRatio: 0.5,
  });

  const overComplete = patchUploadProgress(next, 'item-1', {
    bytesSent: 2048,
    totalBytesExpectedToSend: 1024,
  });

  expect(overComplete.items[0]?.progressRatio).toBe(1);
});

test('failed uploads clear stale progress before retry', () => {
  const initial = enqueue(initialUploadQueueState, {
    ...baseQueueItem,
    status: 'uploading',
    attempts: 0,
    bytesSent: 512,
    totalBytesExpectedToSend: 1024,
    progressRatio: 0.5,
  });

  const failed = markUploadStatus(initial, 'item-1', 'failed', 'network');

  expect(failed.items[0]).toMatchObject({
    attempts: 1,
    errorMessage: 'network',
  });
  expect(failed.items[0]?.bytesSent).toBeUndefined();
  expect(failed.items[0]?.totalBytesExpectedToSend).toBeUndefined();
  expect(failed.items[0]?.progressRatio).toBeUndefined();

  const retrying = markUploadStatus(failed, 'item-1', 'processing');

  expect(retrying.items[0]?.errorMessage).toBeUndefined();
  expect(retrying.items[0]?.progressRatio).toBeUndefined();
});

test('clears completed uploads while preserving in-flight and failed items', () => {
  const state = {
    items: [
      { ...baseQueueItem, id: 'item-1', status: 'uploaded' as const },
      { ...baseQueueItem, id: 'item-2', status: 'uploading' as const },
      { ...baseQueueItem, id: 'item-3', status: 'failed' as const },
    ],
  };

  expect(clearCompleted(state).items.map((item) => item.id)).toEqual(['item-2', 'item-3']);
});

test('rejects unsupported mime types but allows long videos and large originals', () => {
  expect(() =>
    assertPreparedUploadAssetMimeTypeSupported({
      kind: 'image',
      mimeType: 'image/gif',
      fileName: 'animated.gif',
    }),
  ).toThrow(/Dateityp/);

  expect(() =>
    assertPreparedUploadAssetMimeTypeSupported({
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: 'long.mp4',
    }),
  ).not.toThrow();

  expect(() =>
    assertPreparedUploadAssetMimeTypeSupported({
      kind: 'image',
      mimeType: 'image/jpeg',
      fileName: 'huge.jpg',
    }),
  ).not.toThrow();
});
