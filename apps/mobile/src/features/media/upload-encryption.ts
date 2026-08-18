import { File } from 'expo-file-system';

import type { AssetKind, MediaLocation } from '@beisammen/contracts';
import { encryptBytes } from '@beisammen/crypto';

import {
  sealAssetEncryption,
  type AssetEncryptionEnvelope,
} from '@/features/crypto/asset-metadata';
import { encryptFileToFile } from '@/features/crypto/file-crypto';
import { getSodium } from '@/features/crypto/sodium';

export type { AssetEncryptionEnvelope };

/** The active circle key an encrypted upload is sealed to. */
export interface UploadCircleKey {
  epoch: number;
  circleKey: Uint8Array;
}

/**
 * Object keys and the plaintext `fileName` column must not leak the original
 * file name; only the extension survives for content-type handling. The real
 * name travels inside the encrypted metadata envelope.
 */
export function genericUploadFileName(fileName: string, kind: AssetKind): string {
  const extension = /\.([a-zA-Z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();

  return `upload.${extension ?? (kind === 'video' ? 'mp4' : 'jpg')}`;
}

export interface ResolvedUploadEncryption {
  encryptedUri: string;
  encryptedPreviewUri: string;
  encryptedSizeBytes: number;
  encryptedPreviewSizeBytes: number;
  /** Only set when the upload carries a Live Photo companion clip. */
  encryptedPairedVideoUri?: string;
  encryptedPairedVideoSizeBytes?: number;
  envelope: AssetEncryptionEnvelope;
}

function fileSizeIfExists(uri: string): number | undefined {
  const file = new File(uri);

  return file.exists && file.size > 0 ? file.size : undefined;
}

/**
 * Produces (or on retry: reuses) the ciphertext files and sealed envelope for
 * an upload. Presigned PUTs are signed for the exact declared byte sizes, so
 * retries must re-upload the identical ciphertext together with the envelope
 * whose wrapped key sealed it; re-encrypting would produce different bytes.
 * The persisted inputs are server-safe ciphertext only — the raw file key is
 * never persisted and only lives in memory for the duration of this call.
 */
export async function resolveUploadEncryption(input: {
  circleKey: UploadCircleKey | null;
  metadata: { fileName: string; location?: MediaLocation };
  sourceUri: string;
  previewUri: string;
  /** Live Photo companion clip; encrypted under the same file key. */
  pairedVideoSourceUri?: string;
  encryptedTargetUri: string;
  encryptedPreviewTargetUri: string;
  encryptedPairedVideoTargetUri?: string;
  persisted?: {
    encryptedCacheUri?: string;
    encryptedPreviewCacheUri?: string;
    encryptedPairedVideoCacheUri?: string;
    encryption?: AssetEncryptionEnvelope;
  };
}): Promise<ResolvedUploadEncryption> {
  const persisted = input.persisted;
  const hasPairedVideo = Boolean(input.pairedVideoSourceUri);

  // The persisted short-circuit is all-or-nothing: every ciphertext is sealed
  // under the one file key wrapped in the envelope, so a missing paired-video
  // ciphertext forces a full re-encrypt of all files under a fresh key.
  if (
    persisted?.encryptedCacheUri &&
    persisted.encryptedPreviewCacheUri &&
    persisted.encryption &&
    (!hasPairedVideo || persisted.encryptedPairedVideoCacheUri)
  ) {
    const encryptedSizeBytes = fileSizeIfExists(persisted.encryptedCacheUri);
    const encryptedPreviewSizeBytes = fileSizeIfExists(persisted.encryptedPreviewCacheUri);
    const encryptedPairedVideoSizeBytes = persisted.encryptedPairedVideoCacheUri
      ? fileSizeIfExists(persisted.encryptedPairedVideoCacheUri)
      : undefined;

    if (
      encryptedSizeBytes !== undefined &&
      encryptedPreviewSizeBytes !== undefined &&
      (!hasPairedVideo || encryptedPairedVideoSizeBytes !== undefined)
    ) {
      return {
        encryptedUri: persisted.encryptedCacheUri,
        encryptedPreviewUri: persisted.encryptedPreviewCacheUri,
        encryptedSizeBytes,
        encryptedPreviewSizeBytes,
        ...(hasPairedVideo && persisted.encryptedPairedVideoCacheUri
          ? {
              encryptedPairedVideoUri: persisted.encryptedPairedVideoCacheUri,
              encryptedPairedVideoSizeBytes,
            }
          : {}),
        envelope: persisted.encryption,
      };
    }
  }

  if (!input.circleKey) {
    throw new Error('Der Verschlüsselungsschlüssel für diesen Circle ist noch nicht bereit.');
  }

  const sodium = await getSodium();
  const { fileKey, envelope } = sealAssetEncryption({
    sodium,
    circleKey: input.circleKey.circleKey,
    circleEpoch: input.circleKey.epoch,
    metadata: {
      v: 1,
      fileName: input.metadata.fileName,
      ...(input.metadata.location ? { location: input.metadata.location } : {}),
    },
  });
  const encrypted = await encryptFileToFile({
    sodium,
    fileKey,
    sourceUri: input.sourceUri,
    targetUri: input.encryptedTargetUri,
  });
  const previewCiphertext = encryptBytes(sodium, {
    fileKey,
    plaintext: await new File(input.previewUri).bytes(),
  });
  const previewTarget = new File(input.encryptedPreviewTargetUri);

  previewTarget.create({ intermediates: true, overwrite: true });
  previewTarget.write(previewCiphertext);

  let pairedVideoFields: Pick<
    ResolvedUploadEncryption,
    'encryptedPairedVideoUri' | 'encryptedPairedVideoSizeBytes'
  > = {};

  if (input.pairedVideoSourceUri) {
    if (!input.encryptedPairedVideoTargetUri) {
      throw new Error('Für das Live-Video ist kein lokaler Speicher verfügbar.');
    }

    const encryptedPairedVideo = await encryptFileToFile({
      sodium,
      fileKey,
      sourceUri: input.pairedVideoSourceUri,
      targetUri: input.encryptedPairedVideoTargetUri,
    });

    pairedVideoFields = {
      encryptedPairedVideoUri: input.encryptedPairedVideoTargetUri,
      encryptedPairedVideoSizeBytes: encryptedPairedVideo.ciphertextLength,
    };
  }

  return {
    encryptedUri: input.encryptedTargetUri,
    encryptedPreviewUri: input.encryptedPreviewTargetUri,
    encryptedSizeBytes: encrypted.ciphertextLength,
    encryptedPreviewSizeBytes: previewCiphertext.byteLength,
    ...pairedVideoFields,
    envelope,
  };
}

/**
 * The completion fields an encrypted upload sends to `uploads.complete`: the
 * envelope replaces the plaintext location and original file name entirely,
 * while dimensions, duration and capture time deliberately stay plaintext for
 * feed layout and sorting. The absence of a `location` key in the return type
 * is load-bearing — the server rejects a plaintext location next to
 * `encryption`.
 */
export function encryptedCompletionFields(input: {
  fileName: string;
  kind: AssetKind;
  encrypted: Pick<ResolvedUploadEncryption, 'encryptedSizeBytes' | 'envelope'>;
  asset: {
    width?: number;
    height?: number;
    durationSeconds?: number;
    pairedVideoDurationSeconds?: number;
    capturedAt?: number;
  };
}): {
  fileName: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  pairedVideoDurationSeconds?: number;
  capturedAt?: number;
  encryption: AssetEncryptionEnvelope;
} {
  return {
    fileName: genericUploadFileName(input.fileName, input.kind),
    sizeBytes: input.encrypted.encryptedSizeBytes,
    width: input.asset.width,
    height: input.asset.height,
    durationSeconds: input.asset.durationSeconds,
    pairedVideoDurationSeconds: input.asset.pairedVideoDurationSeconds,
    capturedAt: input.asset.capturedAt,
    encryption: input.encrypted.envelope,
  };
}
