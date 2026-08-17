import type { MediaLocation } from '@beisammen/contracts';
import {
  decryptBytes,
  encryptBytes,
  fromBase64,
  fromUtf8Bytes,
  generateFileKey,
  toBase64,
  toUtf8Bytes,
  unwrapFileKey,
  wrapFileKey,
  type SodiumApi,
} from '@beisammen/crypto';

/**
 * Private per-asset metadata that never reaches the server in plaintext.
 * Serialized as JSON and BSE1-encrypted with the asset's file key into
 * `assets.encryption.encMetadata`.
 */
export interface EncryptedAssetMetadata {
  v: 1;
  fileName?: string;
  location?: MediaLocation;
}

/** The server-storable envelope shape mirrored from `convex/schema.ts`. */
export interface AssetEncryptionEnvelope {
  v: 1;
  circleEpoch: number;
  wrappedFileKey: string;
  encMetadata?: string;
}

export function sealAssetEncryption(input: {
  sodium: SodiumApi;
  circleKey: Uint8Array;
  circleEpoch: number;
  metadata: EncryptedAssetMetadata;
}): { fileKey: Uint8Array; envelope: AssetEncryptionEnvelope } {
  const fileKey = generateFileKey(input.sodium);
  const encMetadata = toBase64(
    encryptBytes(input.sodium, {
      fileKey,
      plaintext: toUtf8Bytes(JSON.stringify(input.metadata)),
    }),
  );

  return {
    fileKey,
    envelope: {
      v: 1,
      circleEpoch: input.circleEpoch,
      wrappedFileKey: wrapFileKey(input.sodium, { fileKey, circleKey: input.circleKey }),
      encMetadata,
    },
  };
}

export function unwrapAssetFileKey(input: {
  sodium: SodiumApi;
  envelope: Pick<AssetEncryptionEnvelope, 'circleEpoch' | 'wrappedFileKey'>;
  keysByEpoch: Map<number, Uint8Array>;
}): Uint8Array {
  const circleKey = input.keysByEpoch.get(input.envelope.circleEpoch);

  if (!circleKey) {
    throw new Error(`No circle key available for epoch ${input.envelope.circleEpoch}.`);
  }

  return unwrapFileKey(input.sodium, {
    wrappedFileKey: input.envelope.wrappedFileKey,
    circleKey,
  });
}

export function openAssetMetadata(input: {
  sodium: SodiumApi;
  fileKey: Uint8Array;
  encMetadata: string;
}): EncryptedAssetMetadata {
  const parsed = JSON.parse(
    fromUtf8Bytes(
      decryptBytes(input.sodium, {
        fileKey: input.fileKey,
        ciphertext: fromBase64(input.encMetadata),
      }),
    ),
  ) as EncryptedAssetMetadata;

  if (parsed.v !== 1) {
    throw new Error(`Unsupported asset metadata version ${String(parsed.v)}.`);
  }

  return parsed;
}
