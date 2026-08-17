import { chunkCount, type FileHeader } from '@beisammen/crypto';

import { createLogger } from '@/lib/logger';
import {
  formatResponseHead,
  parseRangeHeader,
  tryParseRequestHead,
  type ByteRange,
  type HttpRequest,
} from './http';
import type { EncryptedVideoSession } from './session';

const logger = createLogger('media.videoProxy');

/** Ciphertext chunks fetched from R2 per ranged request while streaming. */
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
    ): Promise<void> {
      const firstChunk = Math.floor(range.start / header.chunkSize);
      const lastChunk = Math.floor(range.end / header.chunkSize);

      for (
        let spanStart = firstChunk;
        spanStart <= lastChunk && !closed;
        spanStart += FETCH_SPAN_CHUNKS
      ) {
        const spanEnd = Math.min(spanStart + FETCH_SPAN_CHUNKS - 1, lastChunk);
        const chunks = await session.decryptChunkSpan(header, spanStart, spanEnd);

        for (let index = 0; index < chunks.length && !closed; index += 1) {
          const chunkIndex = spanStart + index;
          const chunkOffset = chunkIndex * header.chunkSize;
          const sliceStart = Math.max(0, range.start - chunkOffset);
          const sliceEnd = Math.min(chunks[index].length, range.end + 1 - chunkOffset);

          if (sliceEnd > sliceStart) {
            await io.write(chunks[index].subarray(sliceStart, sliceEnd));
          }
        }
      }
    }

    async function handleRequest(request: HttpRequest): Promise<void> {
      const token = tokenFromPath(request.path);
      const session = token ? registry.get(token) : undefined;

      if (!session || (request.method !== 'GET' && request.method !== 'HEAD')) {
        await writeError(session ? 405 : 404, session ? 'Method Not Allowed' : 'Not Found');
        return;
      }

      const header = await session.ensureHeader();
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
          await streamPlaintextRange(session, header, { start: 0, end: totalLength - 1 });
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
      await streamPlaintextRange(session, header, range);
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
