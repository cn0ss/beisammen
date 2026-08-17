import {
  FILE_HEADER_BYTES,
  ciphertextLength,
  ciphertextRangeForChunk,
  decryptChunk,
  parseFileHeader,
  type FileHeader,
  type SodiumApi,
} from '@beisammen/crypto';

/** Signed URLs live 5 minutes; refresh with headroom before expiry. */
const SIGNED_URL_REFRESH_MARGIN_MS = 30_000;

export interface SignedUrlProvider {
  (): Promise<{ url: string | null; expiresAt: number | null }>;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * One playable encrypted asset: unwrapped file key (memory only), the parsed
 * BSE1 header (bootstrapped via a 36-byte range request), and a cached
 * presigned R2 URL that is refreshed on expiry or 403. All ciphertext bytes
 * flow directly between the device and R2; Convex only signs URLs.
 */
export class EncryptedVideoSession {
  readonly mimeType: string;

  private readonly sodium: SodiumApi;
  private readonly fileKey: Uint8Array;
  private readonly getSignedUrl: SignedUrlProvider;
  private readonly fetchFn: FetchLike;
  private cachedUrl: { url: string; expiresAt: number | null } | null = null;
  private headerPromise: Promise<FileHeader> | null = null;

  constructor(input: {
    sodium: SodiumApi;
    fileKey: Uint8Array;
    mimeType: string;
    getSignedUrl: SignedUrlProvider;
    fetchFn?: FetchLike;
  }) {
    this.sodium = input.sodium;
    this.fileKey = input.fileKey;
    this.mimeType = input.mimeType;
    this.getSignedUrl = input.getSignedUrl;
    this.fetchFn = input.fetchFn ?? (fetch as unknown as FetchLike);
  }

  private async resolveUrl(forceRefresh: boolean): Promise<string> {
    const now = Date.now();
    const cached = this.cachedUrl;

    if (
      !forceRefresh &&
      cached &&
      (cached.expiresAt === null || cached.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS > now)
    ) {
      return cached.url;
    }

    const signed = await this.getSignedUrl();

    if (!signed.url) {
      throw new Error('No signed URL available for encrypted video.');
    }

    this.cachedUrl = { url: signed.url, expiresAt: signed.expiresAt };

    return signed.url;
  }

  /** Ranged ciphertext fetch straight from R2; end is exclusive. */
  async fetchCiphertextRange(start: number, endExclusive: number): Promise<Uint8Array> {
    const attempt = async (forceRefresh: boolean): Promise<Uint8Array> => {
      const url = await this.resolveUrl(forceRefresh);
      const response = await this.fetchFn(url, {
        headers: { range: `bytes=${start}-${endExclusive - 1}` },
      });

      if (response.status === 403 && !forceRefresh) {
        throw new RefreshableUrlError();
      }

      if (response.status !== 206 && response.status !== 200) {
        throw new Error(`Ciphertext range request failed with status ${response.status}.`);
      }

      const body = new Uint8Array(await response.arrayBuffer());

      // A 200 means the server ignored the range; slice locally.
      const bytes =
        response.status === 200 ? body.subarray(start, endExclusive) : body;

      if (bytes.length !== endExclusive - start) {
        throw new Error('Ciphertext range response has an unexpected length.');
      }

      return bytes;
    };

    try {
      return await attempt(false);
    } catch (error) {
      if (error instanceof RefreshableUrlError) {
        return await attempt(true);
      }

      throw error;
    }
  }

  async ensureHeader(): Promise<FileHeader> {
    if (!this.headerPromise) {
      this.headerPromise = this.fetchCiphertextRange(0, FILE_HEADER_BYTES)
        .then((bytes) => parseFileHeader(bytes))
        .catch((error: unknown) => {
          this.headerPromise = null;
          throw error;
        });
    }

    return await this.headerPromise;
  }

  async decryptChunkAt(header: FileHeader, chunkIndex: number): Promise<Uint8Array> {
    const range = ciphertextRangeForChunk(header, chunkIndex);
    const ciphertext = await this.fetchCiphertextRange(range.start, range.end);

    return decryptChunk(this.sodium, {
      fileKey: this.fileKey,
      header,
      chunkIndex,
      ciphertext,
    });
  }

  async decryptChunkSpan(
    header: FileHeader,
    chunkStart: number,
    chunkEnd: number,
  ): Promise<Uint8Array[]> {
    const spanStart = ciphertextRangeForChunk(header, chunkStart).start;
    const spanEnd = ciphertextRangeForChunk(header, chunkEnd).end;
    const span = await this.fetchCiphertextRange(spanStart, spanEnd);
    const chunks: Uint8Array[] = [];

    for (let chunkIndex = chunkStart; chunkIndex <= chunkEnd; chunkIndex += 1) {
      const range = ciphertextRangeForChunk(header, chunkIndex);

      chunks.push(
        decryptChunk(this.sodium, {
          fileKey: this.fileKey,
          header,
          chunkIndex,
          ciphertext: span.subarray(range.start - spanStart, range.end - spanStart),
        }),
      );
    }

    return chunks;
  }

  totalCiphertextLength(header: FileHeader): number {
    return ciphertextLength(header);
  }
}

class RefreshableUrlError extends Error {
  constructor() {
    super('Signed URL rejected; refresh required.');
  }
}
