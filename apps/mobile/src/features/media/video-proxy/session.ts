import {
  FILE_HEADER_BYTES,
  chunkCount,
  ciphertextLength,
  ciphertextRangeForChunk,
  decryptChunk,
  parseFileHeader,
  type FileHeader,
  type SodiumApi,
} from '@beisammen/crypto';

import { createVideoPerfLogger } from '../video-logging';

const logger = createVideoPerfLogger('media.videoSession');

/** Signed URLs live 5 minutes; refresh with headroom before expiry. */
const SIGNED_URL_REFRESH_MARGIN_MS = 30_000;

/**
 * Upper bound for a single ranged fetch. Range bounds are derived from the
 * unauthenticated BSE1 header, so they must never drive an unbounded
 * `arrayBuffer` allocation; the largest legitimate request is one span of
 * MAX_CHUNK_SIZE chunks, which stays far below this cap.
 */
const MAX_RANGE_BYTES = 64 * 1024 * 1024;

/**
 * Recently fetched ciphertext chunks kept per session (LRU). AVPlayer probes
 * the head and tail of a file with several overlapping range requests before
 * playback starts; without this cache every probe re-downloads full chunks
 * from R2.
 */
const CIPHERTEXT_CACHE_CHUNKS = 8;

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
  /** Ciphertext by chunk index; Map iteration order doubles as LRU order. */
  private readonly chunkCache = new Map<number, Uint8Array>();
  /**
   * In-flight ciphertext fetches by chunk index, shared across concurrent
   * proxy connections (AVPlayer opens several at once) so overlapping
   * requests never download the same chunk twice.
   */
  private readonly inflightChunks = new Map<number, Promise<Uint8Array>>();

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

    const signStartedAt = Date.now();
    const signed = await this.getSignedUrl();

    logger.debug('Signed URL resolved.', {
      forceRefresh,
      signMs: Date.now() - signStartedAt,
    });

    if (!signed.url) {
      throw new Error('No signed URL available for encrypted video.');
    }

    this.cachedUrl = { url: signed.url, expiresAt: signed.expiresAt };

    return signed.url;
  }

  /** Ranged ciphertext fetch straight from R2; end is exclusive. */
  async fetchCiphertextRange(start: number, endExclusive: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(endExclusive) ||
      start < 0 ||
      endExclusive <= start
    ) {
      throw new Error('Invalid ciphertext range.');
    }

    if (endExclusive - start > MAX_RANGE_BYTES) {
      throw new Error('Ciphertext range exceeds the allowed fetch size.');
    }

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

    const fetchStartedAt = Date.now();

    try {
      const bytes = await attempt(false);

      logger.debug('Ciphertext range fetched.', {
        start,
        bytes: bytes.length,
        fetchMs: Date.now() - fetchStartedAt,
      });

      return bytes;
    } catch (error) {
      if (error instanceof RefreshableUrlError) {
        const bytes = await attempt(true);

        logger.debug('Ciphertext range fetched after URL refresh.', {
          start,
          bytes: bytes.length,
          fetchMs: Date.now() - fetchStartedAt,
        });

        return bytes;
      }

      throw error;
    }
  }

  async ensureHeader(): Promise<FileHeader> {
    if (!this.headerPromise) {
      const bootstrapStartedAt = Date.now();

      this.headerPromise = this.fetchCiphertextRange(0, FILE_HEADER_BYTES)
        .then((bytes) => {
          const header = parseFileHeader(bytes);

          logger.debug('File header bootstrapped.', {
            headerMs: Date.now() - bootstrapStartedAt,
            chunkSize: header.chunkSize,
            plaintextLength: header.plaintextLength,
          });

          return header;
        })
        .catch((error: unknown) => {
          this.headerPromise = null;
          throw error;
        });
    }

    return await this.headerPromise;
  }

  private cachedChunk(chunkIndex: number): Uint8Array | null {
    const bytes = this.chunkCache.get(chunkIndex);

    if (!bytes) {
      return null;
    }

    // Re-insert to refresh the LRU position.
    this.chunkCache.delete(chunkIndex);
    this.chunkCache.set(chunkIndex, bytes);

    return bytes;
  }

  private cacheChunk(chunkIndex: number, bytes: Uint8Array): void {
    this.chunkCache.delete(chunkIndex);
    this.chunkCache.set(chunkIndex, bytes);

    while (this.chunkCache.size > CIPHERTEXT_CACHE_CHUNKS) {
      const oldest = this.chunkCache.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.chunkCache.delete(oldest);
    }
  }

  /** One range request for chunks `start..end`, split into per-chunk shared
   * promises that land in the LRU cache and the in-flight map. */
  private startRunFetch(header: FileHeader, start: number, end: number): Promise<Uint8Array>[] {
    const spanStart = ciphertextRangeForChunk(header, start).start;
    const spanEnd = ciphertextRangeForChunk(header, end).end;
    const spanPromise = this.fetchCiphertextRange(spanStart, spanEnd);
    const chunkPromises: Promise<Uint8Array>[] = [];

    for (let chunkIndex = start; chunkIndex <= end; chunkIndex += 1) {
      const range = ciphertextRangeForChunk(header, chunkIndex);
      const chunkPromise = spanPromise.then((span) => {
        // Copy out of the span buffer so a cached chunk doesn't retain the
        // whole multi-chunk allocation.
        const bytes = span.slice(range.start - spanStart, range.end - spanStart);

        this.cacheChunk(chunkIndex, bytes);

        return bytes;
      });
      const settle = () => {
        if (this.inflightChunks.get(chunkIndex) === chunkPromise) {
          this.inflightChunks.delete(chunkIndex);
        }
      };

      this.inflightChunks.set(chunkIndex, chunkPromise);
      void chunkPromise.then(settle, settle);
      chunkPromises.push(chunkPromise);
    }

    return chunkPromises;
  }

  /**
   * Ciphertext for chunks `chunkStart..chunkEnd` (inclusive): LRU cache hits
   * are free, chunks another connection is already downloading are awaited
   * rather than re-fetched, and each remaining contiguous run costs one range
   * request.
   */
  private async chunkCiphertexts(
    header: FileHeader,
    chunkStart: number,
    chunkEnd: number,
  ): Promise<Uint8Array[]> {
    const byIndex = new Map<number, Promise<Uint8Array>>();
    const missing: number[] = [];

    for (let chunkIndex = chunkStart; chunkIndex <= chunkEnd; chunkIndex += 1) {
      const cached = this.cachedChunk(chunkIndex);

      if (cached) {
        byIndex.set(chunkIndex, Promise.resolve(cached));
        continue;
      }

      const inflight = this.inflightChunks.get(chunkIndex);

      if (inflight) {
        byIndex.set(chunkIndex, inflight);
        continue;
      }

      missing.push(chunkIndex);
    }

    for (let index = 0; index < missing.length; ) {
      let runEnd = index;

      while (runEnd + 1 < missing.length && missing[runEnd + 1] === missing[runEnd] + 1) {
        runEnd += 1;
      }

      const runPromises = this.startRunFetch(header, missing[index], missing[runEnd]);

      for (let offset = 0; offset < runPromises.length; offset += 1) {
        byIndex.set(missing[index] + offset, runPromises[offset]);
      }

      index = runEnd + 1;
    }

    return await Promise.all(
      Array.from({ length: chunkEnd - chunkStart + 1 }, (_, offset) => {
        const chunkPromise = byIndex.get(chunkStart + offset);

        if (!chunkPromise) {
          throw new Error('Ciphertext chunk missing after fetch.');
        }

        return chunkPromise;
      }),
    );
  }

  /**
   * Prefetches the ranges AVPlayer reads before playback starts: the file
   * header, the first chunk (probe requests and faststart moov), and the
   * trailing chunk (moov of regular MP4s). Runs concurrently with real player
   * requests and shares their fetches via the in-flight map.
   */
  async warmUp(): Promise<void> {
    const header = await this.ensureHeader();
    const lastChunk = chunkCount(header) - 1;

    if (lastChunk < 0) {
      return;
    }

    await Promise.all([
      this.chunkCiphertexts(header, 0, 0),
      lastChunk > 0 ? this.chunkCiphertexts(header, lastChunk, lastChunk) : Promise.resolve([]),
    ]);
  }

  async decryptChunkAt(header: FileHeader, chunkIndex: number): Promise<Uint8Array> {
    const [chunk] = await this.decryptChunkSpan(header, chunkIndex, chunkIndex);

    return chunk;
  }

  async decryptChunkSpan(
    header: FileHeader,
    chunkStart: number,
    chunkEnd: number,
  ): Promise<Uint8Array[]> {
    const ciphertexts = await this.chunkCiphertexts(header, chunkStart, chunkEnd);

    return ciphertexts.map((ciphertext, index) =>
      decryptChunk(this.sodium, {
        fileKey: this.fileKey,
        header,
        chunkIndex: chunkStart + index,
        ciphertext,
      }),
    );
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
