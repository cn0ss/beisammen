import type { AssetKind, StorageReference, StorageProviderKind } from '@beisammen/contracts';

export type CircleRole = 'owner' | 'admin' | 'member';

export interface CircleSummary {
  id: string;
  name: string;
  description: string;
  role: CircleRole;
  memberCount: number;
  storageProvider: StorageProviderKind;
  storageLabel: string;
}

export interface ShareAssetSummary {
  id: string;
  kind: AssetKind;
  mimeType: string;
  storage: StorageReference;
  previewStorage?: StorageReference;
}

export interface ShareBatchSummary {
  id: string;
  circleId: string;
  authorName: string;
  caption: string;
  createdAtLabel: string;
  assetCount: number;
  assets: ShareAssetSummary[];
}

export function canManageStorage(role: CircleRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function buildS3ObjectKey(input: {
  circleId: string;
  year: string;
  month: string;
  shareBatchId: string;
  uploadId: string;
  fileName: string;
}): string {
  const sanitizedFileName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');

  return [
    input.circleId,
    input.year,
    input.month,
    input.shareBatchId,
    input.uploadId,
    sanitizedFileName,
  ].join('/');
}

export function formatRelativeTimestamp(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const deltaMinutes = Math.max(1, Math.round(deltaMs / 60000));

  if (deltaMinutes < 60) {
    return `Vor ${deltaMinutes} Min.`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `Vor ${deltaHours} Std.`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `Vor ${deltaDays} Tag${deltaDays === 1 ? '' : 'en'}`;
}
