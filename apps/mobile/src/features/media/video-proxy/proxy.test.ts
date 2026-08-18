import _sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  encryptBytes,
  generateFileKey,
  type SodiumApi,
} from '@beisammen/crypto';

import { createConnectionHandler, type ConnectionIo } from './connection';
import { parseRangeHeader, tryParseRequestHead } from './http';
import { EncryptedVideoSession, type FetchLike } from './session';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

function makeCiphertextStore(plaintext: Uint8Array, chunkSize: number) {
  const fileKey = generateFileKey(sodium);
  const ciphertext = encryptBytes(sodium, { fileKey, plaintext, chunkSize });
  const fetchCalls: string[] = [];
  let rejectNextWith403 = false;

  const fetchFn: FetchLike = async (url, init) => {
    fetchCalls.push(url);

    if (rejectNextWith403) {
      rejectNextWith403 = false;
      return { status: 403, arrayBuffer: async () => new ArrayBuffer(0) };
    }

    const match = /bytes=(\d+)-(\d+)/.exec(init.headers.range);

    if (!match) {
      throw new Error('Expected a ranged request.');
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const body = ciphertext.slice(start, end + 1);

    return {
      status: 206,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };

  return {
    fileKey,
    ciphertext,
    fetchCalls,
    fetchFn,
    trigger403Once: () => {
      rejectNextWith403 = true;
    },
  };
}

function makeSession(input: {
  store: ReturnType<typeof makeCiphertextStore>;
  urls?: Array<{ url: string; expiresAt: number | null }>;
}) {
  const urls = input.urls ?? [{ url: 'https://r2.example/media?sig=1', expiresAt: null }];
  let urlIndex = 0;

  return new EncryptedVideoSession({
    sodium,
    fileKey: input.store.fileKey,
    mimeType: 'video/mp4',
    getSignedUrl: async () => {
      const next = urls[Math.min(urlIndex, urls.length - 1)];

      urlIndex += 1;

      return next;
    },
    fetchFn: input.store.fetchFn,
  });
}

interface CollectedResponse {
  head: string;
  body: Uint8Array;
  ended: boolean;
}

async function performRequest(
  session: EncryptedVideoSession | null,
  rawRequest: string,
): Promise<CollectedResponse> {
  const registry = {
    get: (token: string) => (token === 'tok1' && session ? session : undefined),
  };
  const handler = createConnectionHandler(registry);
  const writes: Uint8Array[] = [];
  let ended = false;
  let resolveEnd: () => void;
  const endPromise = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  const io: ConnectionIo = {
    write: (bytes) => {
      writes.push(bytes.slice());
    },
    end: () => {
      ended = true;
      resolveEnd();
    },
  };
  const connection = handler(io);

  connection.onData(new TextEncoder().encode(rawRequest));
  await endPromise;

  const merged = new Uint8Array(writes.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of writes) {
    merged.set(part, offset);
    offset += part.length;
  }

  const headEnd = merged.findIndex(
    (_, index) =>
      merged[index] === 0x0d &&
      merged[index + 1] === 0x0a &&
      merged[index + 2] === 0x0d &&
      merged[index + 3] === 0x0a,
  );

  return {
    head: new TextDecoder().decode(merged.subarray(0, headEnd)),
    body: merged.subarray(headEnd + 4),
    ended,
  };
}

function randomPlaintext(length: number): Uint8Array {
  return sodium.randombytes_buf(length);
}

describe('http primitives', () => {
  test('parses request heads incrementally', () => {
    expect(tryParseRequestHead(new TextEncoder().encode('GET /v/a HTTP/1.1\r\nRan'))).toBeNull();

    const parsed = tryParseRequestHead(
      new TextEncoder().encode('GET /v/abc HTTP/1.1\r\nHost: x\r\nRange: bytes=0-1\r\n\r\n'),
    );

    expect(parsed).toMatchObject({
      method: 'GET',
      path: '/v/abc',
      headers: { range: 'bytes=0-1' },
    });
  });

  test('parses range headers including suffix and open ranges', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRangeHeader('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader(undefined, 1000)).toBeNull();
  });
});

describe('encrypted video proxy', () => {
  test('serves exact plaintext ranges as 206 responses', async () => {
    const plaintext = randomPlaintext(1000);
    const store = makeCiphertextStore(plaintext, 100);
    const session = makeSession({ store });

    const response = await performRequest(
      session,
      'GET /v/tok1 HTTP/1.1\r\nRange: bytes=150-449\r\n\r\n',
    );

    expect(response.head).toContain('206 Partial Content');
    expect(response.head).toContain('Content-Range: bytes 150-449/1000');
    expect(response.head).toContain('Content-Length: 300');
    expect(response.body).toEqual(plaintext.subarray(150, 450));
    expect(response.ended).toBe(true);
  });

  test('serves suffix ranges and full-body 200s byte-exactly', async () => {
    const plaintext = randomPlaintext(730);
    const store = makeCiphertextStore(plaintext, 64);
    const session = makeSession({ store });

    const suffix = await performRequest(
      session,
      'GET /v/tok1 HTTP/1.1\r\nRange: bytes=-70\r\n\r\n',
    );

    expect(suffix.head).toContain('Content-Range: bytes 660-729/730');
    expect(suffix.body).toEqual(plaintext.subarray(660));

    const full = await performRequest(session, 'GET /v/tok1 HTTP/1.1\r\n\r\n');

    expect(full.head).toContain('200 OK');
    expect(full.head).toContain('Content-Length: 730');
    expect(full.head).toContain('Accept-Ranges: bytes');
    expect(full.body).toEqual(plaintext);
  });

  test('answers HEAD, 404, and 416 correctly', async () => {
    const plaintext = randomPlaintext(300);
    const store = makeCiphertextStore(plaintext, 100);
    const session = makeSession({ store });

    const head = await performRequest(session, 'HEAD /v/tok1 HTTP/1.1\r\n\r\n');

    expect(head.head).toContain('200 OK');
    expect(head.head).toContain('Content-Length: 300');
    expect(head.body.length).toBe(0);

    const missing = await performRequest(null, 'GET /v/tok1 HTTP/1.1\r\n\r\n');

    expect(missing.head).toContain('404 Not Found');

    const unsatisfiable = await performRequest(
      session,
      'GET /v/tok1 HTTP/1.1\r\nRange: bytes=300-\r\n\r\n',
    );

    expect(unsatisfiable.head).toContain('416 Range Not Satisfiable');
    expect(unsatisfiable.head).toContain('Content-Range: bytes */300');
  });

  test('refreshes the signed URL on 403 and keeps serving', async () => {
    const plaintext = randomPlaintext(200);
    const store = makeCiphertextStore(plaintext, 100);
    const session = makeSession({
      store,
      urls: [
        { url: 'https://r2.example/media?sig=old', expiresAt: null },
        { url: 'https://r2.example/media?sig=new', expiresAt: null },
      ],
    });

    // Bootstrap the header, then invalidate the URL for the next fetch.
    await session.ensureHeader();
    store.trigger403Once();

    const response = await performRequest(
      session,
      'GET /v/tok1 HTTP/1.1\r\nRange: bytes=0-99\r\n\r\n',
    );

    expect(response.head).toContain('206 Partial Content');
    expect(response.body).toEqual(plaintext.subarray(0, 100));
    expect(store.fetchCalls).toContain('https://r2.example/media?sig=new');
  });

  // Several MiB of JS-libsodium work; generous timeout for CI machines.
  // Kept small enough not to get the vitest fork OOM-killed on 2-vCPU CI
  // runners, while still spanning 12 chunks.
  // AVPlayer rejects a 206 shorter than the requested range (CoreMedia
  // -12939), so an open-ended request must serve the full remainder.
  test('serves open-ended range requests in full', { timeout: 60_000 }, async () => {
    const plaintext = randomPlaintext(3 * 1024 * 1024);
    const store = makeCiphertextStore(plaintext, 256 * 1024);
    const session = makeSession({ store });

    const response = await performRequest(
      session,
      'GET /v/tok1 HTTP/1.1\r\nRange: bytes=0-\r\n\r\n',
    );

    expect(response.head).toContain(
      `Content-Range: bytes 0-${plaintext.length - 1}/${plaintext.length}`,
    );
    expect(response.body.length).toBe(plaintext.length);
    expect(response.body.every((byte, index) => byte === plaintext[index])).toBe(true);
  });

  test.each([64 * 1024 * 1024, 1024 ** 3, 0xffffffff])(
    'rejects a crafted header chunkSize of %s before any large range request',
    async (chunkSize) => {
      const store = makeCiphertextStore(randomPlaintext(200), 100);

      // The chunkSize field sits at header offset 8 and is read before any
      // chunk is authenticated; a crafted value must fail parsing instead of
      // driving a multi-gigabyte range request and allocation.
      new DataView(store.ciphertext.buffer, store.ciphertext.byteOffset).setUint32(
        8,
        chunkSize,
        true,
      );

      const session = makeSession({ store });
      const response = await performRequest(
        session,
        'GET /v/tok1 HTTP/1.1\r\nRange: bytes=0-99\r\n\r\n',
      );

      expect(response.head).toContain('500 Internal Server Error');
      // Only the 36-byte header bootstrap fetch happened; no data ranges.
      expect(store.fetchCalls).toHaveLength(1);
    },
  );

  test('the session refuses ranges beyond the fetch cap outright', async () => {
    const store = makeCiphertextStore(randomPlaintext(100), 100);
    const session = makeSession({ store });

    await expect(session.fetchCiphertextRange(0, 65 * 1024 * 1024)).rejects.toThrow(
      /exceeds the allowed fetch size/i,
    );
    await expect(session.fetchCiphertextRange(10, 10)).rejects.toThrow(/invalid ciphertext range/i);
    expect(store.fetchCalls).toHaveLength(0);
  });

  test('dedupes concurrent chunk fetches and serves repeats from cache', async () => {
    const plaintext = randomPlaintext(300);
    const store = makeCiphertextStore(plaintext, 100);
    const session = makeSession({ store });
    const header = await session.ensureHeader();
    const afterHeader = store.fetchCalls.length;

    const [firstSpan, secondSpan] = await Promise.all([
      session.decryptChunkSpan(header, 0, 1),
      session.decryptChunkSpan(header, 0, 2),
    ]);

    // Chunks 0-1 downloaded once (in-flight fetch shared with the second
    // caller); only chunk 2 needed an additional range request.
    expect(store.fetchCalls).toHaveLength(afterHeader + 2);
    expect(firstSpan[0]).toEqual(plaintext.subarray(0, 100));
    expect(firstSpan[1]).toEqual(plaintext.subarray(100, 200));
    expect(secondSpan[2]).toEqual(plaintext.subarray(200, 300));

    // A repeated span is served entirely from the LRU cache.
    await session.decryptChunkSpan(header, 0, 2);
    expect(store.fetchCalls).toHaveLength(afterHeader + 2);
  });

  test('warmUp preloads the header plus head and tail chunks', async () => {
    const plaintext = randomPlaintext(300);
    const store = makeCiphertextStore(plaintext, 100);
    const session = makeSession({ store });

    await session.warmUp();

    const afterWarmUp = store.fetchCalls.length;
    const header = await session.ensureHeader();

    expect(await session.decryptChunkAt(header, 0)).toEqual(plaintext.subarray(0, 100));
    expect(await session.decryptChunkAt(header, 2)).toEqual(plaintext.subarray(200, 300));
    // Both probe targets were already warm; no fetches beyond the warm-up.
    expect(store.fetchCalls).toHaveLength(afterWarmUp);
  });
});
