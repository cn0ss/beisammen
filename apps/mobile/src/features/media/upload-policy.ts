import {
  BETA_MAX_MEDIA_SELECTION_COUNT,
  assertPreparedUploadAssetWithinBetaLimits,
  assertPreparedUploadAssetMimeTypeSupported,
} from '@beisammen/upload-client';

import type { DeploymentKind } from '@beisammen/contracts';
import type { PreparedUploadAsset } from './client';

export function isCloudDeployment(kind: DeploymentKind): boolean {
  return kind === 'cloud';
}

export function mediaSelectionLimitForDeployment(kind: DeploymentKind): number {
  return isCloudDeployment(kind) ? BETA_MAX_MEDIA_SELECTION_COUNT : 0;
}

export function assertPreparedAssetAllowedForDeployment(input: {
  deploymentKind: DeploymentKind;
  asset: PreparedUploadAsset;
}): void {
  assertPreparedUploadAssetMimeTypeSupported(input.asset);

  if (isCloudDeployment(input.deploymentKind)) {
    assertPreparedUploadAssetWithinBetaLimits(input.asset);
  }
}
