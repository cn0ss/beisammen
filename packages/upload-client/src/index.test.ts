import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  assertPreparedUploadAssetWithinBetaLimits,
  assertUploadBatchWithinBetaLimits,
  enqueue,
  initialUploadQueueState,
  markUploadStatus,
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

test('rejects media selections beyond the beta batch limit', () => {
  expect(() => assertUploadBatchWithinBetaLimits({ selectedCount: 11 })).toThrow(/10 Medien/);
  expect(() =>
    assertUploadBatchWithinBetaLimits({ selectedCount: 6, existingPendingCount: 5 }),
  ).toThrow(/10 Medien/);
  expect(() =>
    assertUploadBatchWithinBetaLimits({
      selectedCount: 1,
      existingPendingCount: 1,
      existingDraftAssetCount: 9,
    }),
  ).toThrow(/10 Medien/);
});

test('rejects unsupported prepared upload assets but allows large originals', () => {
  expect(() =>
    assertPreparedUploadAssetWithinBetaLimits({
      kind: 'image',
      mimeType: 'image/gif',
      fileName: 'animated.gif',
    }),
  ).toThrow(/Dateityp/);

  expect(() =>
    assertPreparedUploadAssetWithinBetaLimits({
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: 'long.mp4',
      durationSeconds: 31,
    }),
  ).toThrow(/30 Sekunden/);

  expect(() =>
    assertPreparedUploadAssetWithinBetaLimits({
      kind: 'image',
      mimeType: 'image/jpeg',
      fileName: 'huge.jpg',
      sizeBytes: 51 * 1024 * 1024,
    }),
  ).not.toThrow();
});
