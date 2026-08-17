import {
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
  MAX_PREVIEW_SIZE_BYTES,
  MAX_UPLOAD_SIZE_BYTES,
} from '@beisammen/contracts';

type MediaKind = 'image' | 'video';

export { MAX_IMAGE_UPLOAD_SIZE_BYTES, MAX_PREVIEW_SIZE_BYTES, MAX_UPLOAD_SIZE_BYTES };

function assertPositiveIntegerSize(value: number, label: string, ceiling: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer byte count.`);
  }

  if (value > ceiling) {
    throw new Error(`${label} exceeds the maximum allowed size of ${ceiling} bytes.`);
  }
}

/** Validates the client-declared sizes for a media upload target. */
export function assertValidDeclaredUploadSizes(input: {
  sizeBytes: number;
  previewSizeBytes: number;
}): void {
  assertPositiveIntegerSize(input.sizeBytes, 'Declared upload size', MAX_UPLOAD_SIZE_BYTES);
  assertPositiveIntegerSize(
    input.previewSizeBytes,
    'Declared preview size',
    MAX_PREVIEW_SIZE_BYTES,
  );
}

/** Validates the client-declared size for an avatar or circle image upload. */
export function assertValidDeclaredImageSize(sizeBytes: number): void {
  assertPositiveIntegerSize(sizeBytes, 'Declared image size', MAX_IMAGE_UPLOAD_SIZE_BYTES);
}

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

