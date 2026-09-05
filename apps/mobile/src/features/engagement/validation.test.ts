import { describe, expect, test } from 'vitest';

import { buildCommentTarget } from './validation';
import { buildShareDetailHref } from './navigation';

describe('engagement validation', () => {
  test('switches comment targets between share and active asset', () => {
    expect(buildCommentTarget({ shareBatchId: 'share-1' })).toEqual({
      shareBatchId: 'share-1',
      targetKind: 'share',
      assetId: undefined,
      label: 'Beitrag',
    });
    expect(
      buildCommentTarget({
        shareBatchId: 'share-1',
        activeAssetId: 'asset-1',
      }),
    ).toEqual({
      shareBatchId: 'share-1',
      targetKind: 'asset',
      assetId: 'asset-1',
      label: 'Aktuelles Medium',
    });
  });

  test('builds share detail routes with optional active assets', () => {
    expect(buildShareDetailHref({ shareBatchId: 'share 1' })).toBe('/share/share%201');
    expect(
      buildShareDetailHref({
        shareBatchId: 'share/1',
        assetId: 'asset 2',
      }),
    ).toBe('/share/share%2F1?assetId=asset%202');
  });
});
