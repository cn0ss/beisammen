import _sodium from 'libsodium-wrappers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('@/features/crypto/sodium', async () => {
  const sodium = (await import('libsodium-wrappers')).default;

  return {
    getSodium: async () => {
      await sodium.ready;
      return sodium as unknown as import('@beisammen/crypto').SodiumApi;
    },
  };
});

// Fake native TCP layer: captures the connection listener so tests can hand
// in fake sockets, and reports a fixed OS-assigned port.
const tcp = vi.hoisted(() => ({
  port: 45111,
  connectionListener: null as ((socket: unknown) => void) | null,
  serverErrorListeners: [] as Array<(error: Error) => void>,
  listenCount: 0,
  reset() {
    this.connectionListener = null;
    this.serverErrorListeners = [];
    this.listenCount = 0;
  },
}));

vi.mock('react-native-tcp-socket', () => ({
  default: {
    createServer: (listener: (socket: unknown) => void) => {
      tcp.connectionListener = listener;

      return {
        listen: (_options: { port: number; host: string }, callback?: () => void) => {
          tcp.listenCount += 1;
          queueMicrotask(() => callback?.());
        },
        address: () => ({ address: '127.0.0.1', port: tcp.port, family: 'IPv4' }),
        on: (event: string, errorListener: (error: Error) => void) => {
          if (event === 'error') {
            tcp.serverErrorListeners.push(errorListener);
          }
        },
        close: () => undefined,
      };
    },
  },
}));

import { encryptBytes, generateFileKey, type SodiumApi } from '@beisammen/crypto';

import {
  attachProxySocket,
  createSocketIo,
  ensureVideoProxyServer,
  isVideoProxyUrl,
  registerVideoSession,
  resetVideoProxyServerForTesting,
  toUrlSafeToken,
  unregisterVideoSession,
  type ProxySocketLike,
} from './server';
import { EncryptedVideoSession, type FetchLike } from './session';

let sodium: SodiumApi;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium as unknown as SodiumApi;
});

beforeEach(() => {
  tcp.reset();
  resetVideoProxyServerForTesting();
});

type Listener = (...args: unknown[]) => void;

class FakeSocket implements ProxySocketLike {
  written: Uint8Array[] = [];
  ended = false;
  wasDestroyed = false;
  /** Consumed per write; empty queue means `true` (flushed). */
  writeResults: boolean[] = [];

  private listeners = new Map<string, Listener[]>();
  private endWaiters: Array<() => void> = [];

  on(event: 'data', listener: (data: Uint8Array | string) => void): this;
  on(event: 'close', listener: (hadError: boolean) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: string, listener: (...args: never[]) => void): this {
    const existing = this.listeners.get(event) ?? [];

    existing.push(listener as Listener);
    this.listeners.set(event, existing);

    return this;
  }

  once(event: 'drain', listener: () => void): this {
    const wrapped: Listener = (...args) => {
      const existing = this.listeners.get(event) ?? [];

      this.listeners.set(
        event,
        existing.filter((entry) => entry !== wrapped),
      );
      listener(...(args as []));
    };

    return this.on(event as 'close', wrapped as (hadError: boolean) => void);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args);
    }
  }

  write(data: Uint8Array): boolean {
    this.written.push(data.slice());

    return this.writeResults.length > 0 ? (this.writeResults.shift() as boolean) : true;
  }

  end(): void {
    this.ended = true;
    this.emit('close', false);

    for (const waiter of this.endWaiters.splice(0)) {
      waiter();
    }
  }

  destroy(): void {
    this.wasDestroyed = true;
  }

  async waitForEnd(): Promise<void> {
    if (this.ended) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.endWaiters.push(resolve);
    });
  }

  writtenBytes(): Uint8Array {
    const total = this.written.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;

    for (const part of this.written) {
      merged.set(part, offset);
      offset += part.length;
    }

    return merged;
  }
}

function splitResponse(bytes: Uint8Array): { head: string; body: Uint8Array } {
  const text = new TextDecoder();

  for (let index = 0; index + 3 < bytes.length; index += 1) {
    if (
      bytes[index] === 0x0d &&
      bytes[index + 1] === 0x0a &&
      bytes[index + 2] === 0x0d &&
      bytes[index + 3] === 0x0a
    ) {
      return { head: text.decode(bytes.subarray(0, index)), body: bytes.subarray(index + 4) };
    }
  }

  return { head: text.decode(bytes), body: new Uint8Array(0) };
}

function makeSession(plaintext: Uint8Array, chunkSize: number): EncryptedVideoSession {
  const fileKey = generateFileKey(sodium);
  const ciphertext = encryptBytes(sodium, { fileKey, plaintext, chunkSize });
  const fetchFn: FetchLike = async (_url, init) => {
    const match = /bytes=(\d+)-(\d+)/.exec(init.headers.range);

    if (!match) {
      throw new Error('Expected a ranged request.');
    }

    const body = ciphertext.slice(Number(match[1]), Number(match[2]) + 1);

    return {
      status: 206,
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };

  return new EncryptedVideoSession({
    sodium,
    fileKey,
    mimeType: 'video/mp4',
    getSignedUrl: async () => ({ url: 'https://r2.example/media?sig=1', expiresAt: null }),
    fetchFn,
  });
}

describe('toUrlSafeToken', () => {
  test('matches unpadded base64url reference vectors', () => {
    // Expected values computed with Buffer.toString('base64url').
    expect(toUrlSafeToken(new Uint8Array(Array.from({ length: 18 }, (_, index) => index)))).toBe(
      'AAECAwQFBgcICQoLDA0ODxAR',
    );
    expect(toUrlSafeToken(new Uint8Array(18).fill(255))).toBe('________________________');
    expect(
      toUrlSafeToken(
        new Uint8Array([250, 17, 99, 3, 128, 64, 200, 33, 7, 255, 0, 76, 91, 180, 222, 14, 61, 121]),
      ),
    ).toBe('-hFjA4BAyCEH_wBMW7TeDj15');
  });
});

describe('createSocketIo backpressure', () => {
  test('waits for drain when the socket queues the write', async () => {
    const socket = new FakeSocket();

    socket.writeResults = [false];

    const io = createSocketIo(socket);
    const pending = io.write(new Uint8Array([1, 2, 3]));

    expect(pending).toBeInstanceOf(Promise);

    let resolved = false;

    void (pending as Promise<void>).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    socket.emit('drain');
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  test('returns synchronously when the write flushed', () => {
    const socket = new FakeSocket();
    const io = createSocketIo(socket);

    expect(io.write(new Uint8Array([1]))).toBeUndefined();
    expect(socket.written).toHaveLength(1);
  });

  test('a closing socket releases the drain waiter and mutes further writes', async () => {
    const socket = new FakeSocket();

    socket.writeResults = [false];

    const io = createSocketIo(socket);
    const pending = io.write(new Uint8Array([1, 2]));

    socket.emit('close', false);
    await pending;

    expect(io.write(new Uint8Array([3]))).toBeUndefined();
    expect(socket.written).toHaveLength(1);
  });
});

describe('proxy server glue', () => {
  test('registers sessions under crypto-random URL-safe tokens', async () => {
    const session = makeSession(sodium.randombytes_buf(100), 64);
    const first = await registerVideoSession(session);
    const second = await registerVideoSession(session);

    expect(first.url).toBe(`http://127.0.0.1:${tcp.port}/v/${first.token}`);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(second.token).not.toBe(first.token);
    expect(isVideoProxyUrl(first.url)).toBe(true);
    expect(isVideoProxyUrl('https://r2.example/media')).toBe(false);
    expect(isVideoProxyUrl('file:///cache/x.mp4')).toBe(false);
  });

  test('streams decrypted ranges over a fake socket end to end', async () => {
    const plaintext = sodium.randombytes_buf(1000);
    const session = makeSession(plaintext, 100);
    const { token } = await registerVideoSession(session);

    expect(tcp.connectionListener).not.toBeNull();

    const socket = new FakeSocket();

    tcp.connectionListener?.(socket);
    socket.emit(
      'data',
      new TextEncoder().encode(`GET /v/${token} HTTP/1.1\r\nRange: bytes=150-449\r\n\r\n`),
    );
    await socket.waitForEnd();

    const { head, body } = splitResponse(socket.writtenBytes());

    expect(head).toContain('206 Partial Content');
    expect(head).toContain('Content-Range: bytes 150-449/1000');
    expect(body).toEqual(plaintext.subarray(150, 450));
  });

  test('unregistered tokens answer 404', async () => {
    const session = makeSession(sodium.randombytes_buf(64), 64);
    const { token } = await registerVideoSession(session);

    unregisterVideoSession(token);

    const socket = new FakeSocket();

    tcp.connectionListener?.(socket);
    socket.emit('data', new TextEncoder().encode(`GET /v/${token} HTTP/1.1\r\n\r\n`));
    await socket.waitForEnd();

    expect(splitResponse(socket.writtenBytes()).head).toContain('404 Not Found');
  });

  test('restarts the server on the next use after a server error', async () => {
    await ensureVideoProxyServer();
    expect(tcp.listenCount).toBe(1);

    for (const listener of tcp.serverErrorListeners) {
      listener(new Error('native listener died'));
    }

    await ensureVideoProxyServer();
    expect(tcp.listenCount).toBe(2);
  });

  test('a socket error mid-connection stops the response', async () => {
    const plaintext = sodium.randombytes_buf(300);
    const session = makeSession(plaintext, 100);
    const { token } = await registerVideoSession(session);
    const socket = new FakeSocket();

    attachProxySocket(socket);
    socket.emit('error', new Error('reset by peer'));
    socket.emit('data', new TextEncoder().encode(`GET /v/${token} HTTP/1.1\r\n\r\n`));

    // The connection was closed before the request head arrived; nothing may
    // be written and the socket must have been torn down.
    await Promise.resolve();
    expect(socket.written).toHaveLength(0);
    expect(socket.wasDestroyed).toBe(true);
  });
});
