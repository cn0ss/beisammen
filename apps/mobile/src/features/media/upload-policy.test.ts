import { describe, expect, test } from 'vitest';

import { BETA_MAX_MEDIA_SELECTION_COUNT } from '@beisammen/upload-client';

import {
  assertPreparedAssetAllowedForDeployment,
  mediaSelectionLimitForDeployment,
} from './upload-policy';

const longVideo = {
  uri: 'file:///clip.mp4',
  previewUri: 'file:///clip.jpg',
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  kind: 'video' as const,
  durationSeconds: 60,
};

describe('upload policy', () => {
  test('keeps cloud beta limits and self-hosted unlimited selection', () => {
    expect(mediaSelectionLimitForDeployment('cloud')).toBe(BETA_MAX_MEDIA_SELECTION_COUNT);
    expect(mediaSelectionLimitForDeployment('self-hosted')).toBe(0);
  });

  test('enforces cloud video duration while allowing self-hosted app-level bypass', () => {
    expect(() =>
      assertPreparedAssetAllowedForDeployment({
        deploymentKind: 'cloud',
        asset: longVideo,
      }),
    ).toThrow(/Videos dürfen/i);

    expect(() =>
      assertPreparedAssetAllowedForDeployment({
        deploymentKind: 'self-hosted',
        asset: longVideo,
      }),
    ).not.toThrow();
  });
});
