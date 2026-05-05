import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getCurrentMediaSelectionLimit } from './instance';

export const SHARE_ASSET_DISPLAY_LIMIT = 100;

export function getShareAssetDisplayLimit() {
  const mediaSelectionLimit = getCurrentMediaSelectionLimit();

  return Math.min(
    mediaSelectionLimit ?? SHARE_ASSET_DISPLAY_LIMIT,
    SHARE_ASSET_DISPLAY_LIMIT,
  );
}

export async function listShareAssetsForDisplay(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
): Promise<Array<Doc<'assets'>>> {
  return await ctx.db
    .query('assets')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))
    .take(getShareAssetDisplayLimit());
}
