export function buildShareDetailHref(input: {
  shareBatchId: string;
  assetId?: string | null;
}): string {
  const encodedShareId = encodeURIComponent(input.shareBatchId);

  if (!input.assetId) {
    return `/share/${encodedShareId}`;
  }

  return `/share/${encodedShareId}?assetId=${encodeURIComponent(input.assetId)}`;
}
