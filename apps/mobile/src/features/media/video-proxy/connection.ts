import { chunkCount, type FileHeader } from '@beisammen/crypto';

import { createLogger } from '@/lib/logger';

import { createVideoPerfLogger } from '../video-logging';
import {
  formatResponseHead,
  parseRangeHeader,
  tryParseRequestHead,
  type ByteRange,
  type HttpRequest,
} from './http';
import type { EncryptedVideoSession } from './session';

const logger = createLogger('media.videoProxy');
const perfLogger = createVideoPerfLogger('media.videoProxy');

/**
 * Upper bound on ciphertext chunks fetched from R2 per ranged request while
 * streaming. Spans ramp 1 → 2 → 4 chunks per request: the short first span
 * gets the player its first byte after one small fetch, larger later spans
 * keep steady-state round trips low.
 */
const FETCH_SPAN_CHUNKS = 4;

export interface ConnectionIo {
  write(bytes: Uint8Array): void | Promise<void>;
  end(): void;
}

export interface ProxyRegistry {
  get(token: string): EncryptedVideoSession | undefined;
}

export interface ProxyConnection {
  onData(chunk: Uint8Array): void;
  onClose(): void;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);

  merged.set(left, 0);
  merged.set(right, left.length);

  return merged;
}

function tokenFromPath(path: string): string | null {
  const match = /^\/v\/([A-Za-z0-9_-]+)(?:\?.*)?$/.exec(path);

  return match ? match[1] : null;
}

/** One line per served body: how long the player waited and for how much. */
function logRequestServed(
  requestStartedAt: number,
  headerMs: number,
  range: ByteRange | null,
  totalLength: number,
  stats: { bytesWritten: number; firstWriteAt: number | null },
): void {
  perfLogger.debug('Proxy request served.', {
    range: range ? `${range.start}-${range.end}` : 'full',
    totalLength,
    bytesWritten: stats.bytesWritten,
    headerMs,
    firstByteMs: stats.firstWriteAt === null ? null : stats.firstWriteAt - requestStartedAt,
    totalMs: Date.now() - requestStartedAt,
  });
}

export function createConnectionHandler(registry: ProxyRegistry) {
  return function handleConnection(io: ConnectionIo): ProxyConnection {
    let buffered: Uint8Array = new Uint8Array(0);
    let closed = false;
    let handling = false;

    async function writeError(status: number, statusText: string): Promise<void> {
      await io.write(
        formatResponseHead(status, statusText, {
          'Content-Length': 0,
        }),
      );
    }

    async function streamPlaintextRange(
      session: EncryptedVideoSession,
      header: FileHeader,
      range: ByteRange,
    ): Promise<{ bytesWritten: number; firstWriteAt: number | null }> {
      const firstChunk = Math.floor(range.start / header.chunkSize);
      const lastChunk = Math.floor(range.end / header.chunkSize);
      let bytesWritten = 0;
      let firstWriteAt: number | null = null;

      const spans: Array<{ start: number; end: number }> = [];
      let spanSize = 1;

      for (let start = firstChunk; start <= lastChunk; ) {
        const end = Math.min(start + spanSize - 1, lastChunk);

        spans.push({ start, end });
        start = end + 1;
        spanSize = Math.min(spanSize * 2, FETCH_SPAN_CHUNKS);
      }

      // The next span downloads from R2 while the current one drains to the
      // socket, so fetch latency and socket writes overlap. At most one span
      // is in flight ahead; a span prefetched for a connection that closes
      // mid-write is bounded waste and still lands in the session's LRU cache.
      let nextSpan: Promise<Uint8Array[]> | null =
        spans.length > 0 ? session.decryptChunkSpan(header, spans[0].start, spans[0].end) : null;

      try {
        for (let spanIndex = 0; spanIndex < spans.length && !closed; spanIndex += 1) {
          const span = spans[spanIndex];
          const chunks = await nextSpan;

          nextSpan =
            spanIndex + 1 < spans.length && !closed
              ? session.decryptChunkSpan(
                  header,
                  spans[spanIndex + 1].start,
                  spans[spanIndex + 1].end,
                )
              : null;

          if (!chunks) {
            break;
          }

          for (let index = 0; index < chunks.length && !closed; index += 1) {
            const chunkIndex = span.start + index;
            const chunkOffset = chunkIndex * header.chunkSize;
            const sliceStart = Math.max(0, range.start - chunkOffset);
            const sliceEnd = Math.min(chunks[index].length, range.end + 1 - chunkOffset);

            if (sliceEnd > sliceStart) {
              firstWriteAt ??= Date.now();
              bytesWritten += sliceEnd - sliceStart;
              await io.write(chunks[index].subarray(sliceStart, sliceEnd));
            }
          }
        }
      } finally {
        // An unconsumed prefetch (early close or a failed current span) must
        // not surface as an unhandled rejection.
        nextSpan?.catch(() => undefined);
      }

      return { bytesWritten, firstWriteAt };
    }

    async function handleRequest(request: HttpRequest): Promise<void> {
      const token = tokenFromPath(request.path);
      const session = token ? registry.get(token) : undefined;

      if (!session || (request.method !== 'GET' && request.method !== 'HEAD')) {
        await writeError(session ? 405 : 404, session ? 'Method Not Allowed' : 'Not Found');
        return;
      }

      const requestStartedAt = Date.now();
      const header = await session.ensureHeader();
      const headerMs = Date.now() - requestStartedAt;
      const totalLength = header.plaintextLength;
      const baseHeaders = {
        'Content-Type': session.mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      };
      const range = parseRangeHeader(request.headers.range, totalLength);

      if (range === 'unsatisfiable') {
        await io.write(
          formatResponseHead(416, 'Range Not Satisfiable', {
            ...baseHeaders,
            'Content-Range': `bytes */${totalLength}`,
            'Content-Length': 0,
          }),
        );
        return;
      }

      if (request.method === 'HEAD') {
        await io.write(
          formatResponseHead(200, 'OK', {
            ...baseHeaders,
            'Content-Length': totalLength,
          }),
        );
        return;
      }

      if (!range) {
        await io.write(
          formatResponseHead(200, 'OK', {
            ...baseHeaders,
            'Content-Length': totalLength,
          }),
        );

        if (totalLength > 0 && chunkCount(header) > 0) {
          const stats = await streamPlaintextRange(session, header, {
            start: 0,
            end: totalLength - 1,
          });

          logRequestServed(requestStartedAt, headerMs, null, totalLength, stats);
        }

        return;
      }

      // Serve exactly the requested range: AVPlayer rejects a 206 shorter
      // than what it asked for (CoreMedia -12939 "content range mismatch").
      // A wild `bytes=0-` stays bounded anyway — writes await socket drain,
      // spans stop on `closed`, and the player aborts once it has enough.
      await io.write(
        formatResponseHead(206, 'Partial Content', {
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${totalLength}`,
          'Content-Length': range.end - range.start + 1,
        }),
      );
      const stats = await streamPlaintextRange(session, header, range);

      logRequestServed(requestStartedAt, headerMs, range, totalLength, stats);
    }

    return {
      onData(chunk: Uint8Array): void {
        if (closed || handling) {
          return;
        }

        buffered = concat(buffered, chunk);

        let request: HttpRequest | null;

        try {
          request = tryParseRequestHead(buffered);
        } catch (error) {
          logger.warn('Rejected malformed proxy request.', { error });
          void writeError(400, 'Bad Request').finally(() => io.end());
          closed = true;
          return;
        }

        if (!request) {
          return;
        }

        handling = true;
        handleRequest(request)
          .catch(async (error: unknown) => {
            logger.warn('Video proxy request failed.', { error });

            try {
              await writeError(500, 'Internal Server Error');
            } catch {
              // The head may already be on the wire; closing is all that is left.
            }
          })
          .finally(() => {
            closed = true;
            io.end();
          });
      },
      onClose(): void {
        closed = true;
      },
    };
  };
}
