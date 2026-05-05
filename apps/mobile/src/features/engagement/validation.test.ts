import { describe, expect, test } from 'vitest';

import {
  buildCommentTarget,
  normalizeCommentDraft,
  normalizeReactionEmoji,
} from './validation';
import { buildShareDetailHref } from './navigation';

describe('engagement validation', () => {
  test('normalizes one emoji grapheme and rejects arbitrary text', () => {
    expect(normalizeReactionEmoji('  👍🏽  ')).toBe('👍🏽');
    expect(normalizeReactionEmoji('❤️')).toBe('❤️');
    expect(() => normalizeReactionEmoji('ok')).toThrow(/emoji/i);
    expect(() => normalizeReactionEmoji('👍👍')).toThrow(/single emoji/i);
  });

  test('normalizes comments before submitting', () => {
    expect(normalizeCommentDraft('  Hallo zusammen.\r\nDas war schoen.  ')).toBe(
      'Hallo zusammen.\nDas war schoen.',
    );
    expect(() => normalizeCommentDraft('   ')).toThrow(/comment/i);
  });

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
