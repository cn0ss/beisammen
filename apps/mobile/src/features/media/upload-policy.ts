import { assertPreparedUploadAssetMimeTypeSupported } from '@beisammen/upload-client';

import type { PreparedUploadAsset } from './client';

export function assertPreparedAssetAllowed(asset: PreparedUploadAsset): void {
  assertPreparedUploadAssetMimeTypeSupported(asset);
}
