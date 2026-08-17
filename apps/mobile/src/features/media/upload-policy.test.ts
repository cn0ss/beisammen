import { describe, expect, test } from 'vitest';

import { assertPreparedAssetAllowed } from './upload-policy';

const longVideo = {
  uri: 'file:///clip.mp4',
  previewUri: 'file:///clip.jpg',
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  kind: 'video' as const,
  durationSeconds: 600,
};

describe('upload policy', () => {
  test('allows videos of any length and count', () => {
    expect(() => assertPreparedAssetAllowed(longVideo)).not.toThrow();
  });

  test('rejects unsupported mime types', () => {
    expect(() =>
      assertPreparedAssetAllowed({
        ...longVideo,
        kind: 'image' as const,
        mimeType: 'image/gif',
        fileName: 'animated.gif',
      }),
    ).toThrow(/Dateityp/);
  });
});
