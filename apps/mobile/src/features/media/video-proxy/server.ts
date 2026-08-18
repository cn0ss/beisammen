import TcpSocket from 'react-native-tcp-socket';

import { getSodium } from '@/features/crypto/sodium';
import { createLogger } from '@/lib/logger';

import { createVideoPerfLogger } from '../video-logging';
import { createConnectionHandler, type ConnectionIo } from './connection';
import { asciiEncode } from './http';
import type { EncryptedVideoSession } from './session';

const logger = createLogger('media.videoProxyServer');
const perfLogger = createVideoPerfLogger('media.videoProxyServer');

/** 18 bytes → 24 URL-safe base64 characters, 144 bits of entropy. */
const TOKEN_BYTES = 18;

const BASE64_URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url; token bytes are a multiple of 3, so no padding case. */
export function toUrlSafeToken(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;

    output += BASE64_URL_ALPHABET[a >> 2];
    output += BASE64_URL_ALPHABET[((a & 0x03) << 4) | (b >> 4)];

    if (index + 1 < bytes.length) {
      output += BASE64_URL_ALPHABET[((b & 0x0f) << 2) | (c >> 6)];
    }

    if (index + 2 < bytes.length) {
      output += BASE64_URL_ALPHABET[c & 0x3f];
    }
  }

  return output;
}

/**
 * Structural subset of react-native-tcp-socket's `Socket` used by the proxy.
 * Kept minimal so the io adapter is unit-testable against a fake socket.
 */
export interface ProxySocketLike {
  on(event: 'data', listener: (data: Uint8Array | string) => void): unknown;
  on(event: 'close', listener: (hadError: boolean) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'drain', listener: () => void): unknown;
  /**
   * react-native-tcp-socket accepts `Uint8Array` directly (it wraps it in a
   * `Buffer` internally) and mirrors node semantics: `false` means the bytes
   * were queued in user memory and `'drain'` fires once the queue flushed.
   */
  write(data: Uint8Array): boolean;
  end(): unknown;
  destroy(): unknown;
}

interface ProxyServerLike {
  listen(options: { port: number; host: string }, callback?: () => void): unknown;
  address(): { port: number; address: string; family: string } | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(callback?: (error?: Error) => void): unknown;
}

/**
 * Adapts one socket to the core's `ConnectionIo`. Writes respect
 * backpressure: when the socket queues the bytes (`write` returns false), the
 * returned promise resolves only on `'drain'`, so multi-MB streams never
 * buffer unboundedly. A closed or errored socket releases any pending drain
 * waiter and turns further writes into no-ops (the connection handler stops
 * on its own `closed` flag).
 */
export function createSocketIo(socket: ProxySocketLike): ConnectionIo {
  let broken = false;
  let pendingDrain: (() => void) | null = null;

  const markBroken = () => {
    broken = true;
    const release = pendingDrain;

    pendingDrain = null;
    release?.();
  };

  socket.on('close', markBroken);
  socket.on('error', markBroken);

  return {
    write(bytes: Uint8Array): void | Promise<void> {
      if (broken) {
        return;
      }

      let flushed: boolean;

      try {
        flushed = socket.write(bytes);
      } catch (error) {
        logger.warn('Proxy socket write failed.', { error });
        markBroken();
        return;
      }

      if (flushed || broken) {
        return;
      }

      return new Promise<void>((resolve) => {
        pendingDrain = resolve;
        socket.once('drain', () => {
          if (pendingDrain === resolve) {
            pendingDrain = null;
          }

          resolve();
        });
      });
    },
    end(): void {
      try {
        socket.end();
      } catch {
        // Ending an already-destroyed socket is fine.
      }
    },
  };
}

const sessions = new Map<string, EncryptedVideoSession>();

const handleConnection = createConnectionHandler({
  get: (token) => sessions.get(token),
});

/** Wires one accepted socket to a fresh per-connection state machine. */
export function attachProxySocket(socket: ProxySocketLike): void {
  const connection = handleConnection(createSocketIo(socket));

  socket.on('data', (data) => {
    connection.onData(typeof data === 'string' ? asciiEncode(data) : data);
  });
  socket.on('close', () => {
    connection.onClose();
  });
  socket.on('error', (error) => {
    logger.warn('Proxy socket errored.', { error });
    connection.onClose();

    try {
      socket.destroy();
    } catch {
      // Already gone.
    }
  });
}

let serverPortPromise: Promise<number> | null = null;

function startServer(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server: ProxyServerLike = TcpSocket.createServer((socket) => {
      attachProxySocket(socket);
    });

    server.on('error', (error) => {
      // Covers both failed startup and later runtime errors: forget the
      // instance so the next playback attempt starts a fresh server.
      logger.warn('Video proxy server errored.', { error });
      serverPortPromise = null;
      reject(error);
    });

    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();

      if (!address || typeof address.port !== 'number' || address.port === 0) {
        serverPortPromise = null;
        reject(new Error('Video proxy server has no assigned port.'));
        return;
      }

      perfLogger.debug('Video proxy server listening.', { port: address.port });
      resolve(address.port);
    });
  });
}

/**
 * Lazily starts the singleton loopback server (127.0.0.1, OS-assigned port)
 * and resolves its port. The server stays up for the app's lifetime; sessions
 * are registered and unregistered by their owning hooks.
 */
export function ensureVideoProxyServer(): Promise<number> {
  serverPortPromise ??= startServer().catch((error: unknown) => {
    serverPortPromise = null;
    throw error;
  });

  return serverPortPromise;
}

export interface RegisteredVideoStream {
  token: string;
  url: string;
}

/**
 * Registers a session under a fresh crypto-random token and returns the
 * loopback URL a native video player can stream from.
 */
export async function registerVideoSession(
  session: EncryptedVideoSession,
): Promise<RegisteredVideoStream> {
  const [port, sodium] = await Promise.all([ensureVideoProxyServer(), getSodium()]);
  const token = toUrlSafeToken(sodium.randombytes_buf(TOKEN_BYTES));

  sessions.set(token, session);

  return { token, url: `http://127.0.0.1:${port}/v/${token}` };
}

export function unregisterVideoSession(token: string): void {
  sessions.delete(token);
}

/**
 * True for URLs served by the local proxy. Such a URL yields decrypted
 * plaintext and must never be fed into the download-then-decrypt path.
 */
export function isVideoProxyUrl(url: string): boolean {
  return url.startsWith('http://127.0.0.1:');
}

/** Test hook: forgets the server and all registered sessions. */
export function resetVideoProxyServerForTesting(): void {
  serverPortPromise = null;
  sessions.clear();
}
