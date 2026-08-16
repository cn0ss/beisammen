import { buildShareDetailHref } from '@/features/engagement/navigation';

export function buildNotificationHref(data: Record<string, unknown> | undefined): string | null {
  const shareBatchId = data?.shareBatchId;

  if (typeof shareBatchId !== 'string' || shareBatchId.trim().length === 0) {
    return null;
  }

  const assetId = data?.assetId;

  return buildShareDetailHref({
    shareBatchId,
    assetId: typeof assetId === 'string' && assetId.trim().length > 0 ? assetId : null,
  });
}
