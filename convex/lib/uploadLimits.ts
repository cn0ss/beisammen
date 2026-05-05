import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  BETA_MAX_MEDIA_SELECTION_COUNT,
  BETA_MAX_VIDEO_DURATION_SECONDS,
  getCurrentMediaSelectionLimit,
  getCurrentVideoDurationLimit,
} from './instance';

type MediaKind = 'image' | 'video';

export { BETA_MAX_MEDIA_SELECTION_COUNT, BETA_MAX_VIDEO_DURATION_SECONDS };

const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const;

const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/mov',
] as const;

const supportedImageMimeTypes: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME_TYPES);
const supportedVideoMimeTypes: ReadonlySet<string> = new Set(SUPPORTED_VIDEO_MIME_TYPES);

function normalizeMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase();
}

export function assertUploadTargetWithinBetaLimits(input: {
  kind: MediaKind;
  mimeType: string;
  fileName: string;
}) {
  const mimeType = normalizeMimeType(input.mimeType);
  const supportedMimeTypes =
    input.kind === 'image' ? supportedImageMimeTypes : supportedVideoMimeTypes;

  if (!supportedMimeTypes.has(mimeType)) {
    throw new Error(`File type for ${input.fileName} is not supported during the private beta.`);
  }
}

export function assertCompletedUploadWithinBetaLimits(input: {
  kind: MediaKind;
  mimeType: string;
  fileName: string;
  durationSeconds?: number;
}) {
  assertUploadTargetWithinBetaLimits(input);
  const videoDurationLimit = getCurrentVideoDurationLimit();

  if (
    input.kind === 'video' &&
    videoDurationLimit !== null &&
    input.durationSeconds === undefined
  ) {
    throw new Error('Video duration metadata is required during the private beta.');
  }

  if (
    input.kind === 'video' &&
    videoDurationLimit !== null &&
    input.durationSeconds !== undefined &&
    input.durationSeconds > videoDurationLimit
  ) {
    throw new Error(`Videos must be ${videoDurationLimit} seconds or shorter during the private beta.`);
  }
}

export async function assertDraftHasMediaCapacity(
  ctx: QueryCtx | MutationCtx,
  shareBatchId: Id<'shareBatches'>,
  currentUploadId?: Id<'uploads'>,
) {
  const mediaSelectionLimit = getCurrentMediaSelectionLimit();

  if (mediaSelectionLimit === null) {
    return;
  }

  const assets = await ctx.db
    .query('assets')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))
    .take(mediaSelectionLimit);
  const uploads = await ctx.db
    .query('uploads')
    .withIndex('by_share_batch', (q) => q.eq('shareBatchId', shareBatchId))
    .take(mediaSelectionLimit + 1);
  const incompleteUploadCount = uploads.filter((upload) => {
    if (currentUploadId && upload._id === currentUploadId) {
      return false;
    }

    return !upload.assetId && upload.status !== 'uploaded';
  }).length;

  if (assets.length + incompleteUploadCount >= mediaSelectionLimit) {
    throw new Error(
      `Drafts can contain at most ${mediaSelectionLimit} media items during the private beta.`,
    );
  }
}
