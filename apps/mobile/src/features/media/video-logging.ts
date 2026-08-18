import { createLogger, type Logger } from '@/lib/logger';

/**
 * Master switch for video playback performance instrumentation: load
 * timings, player status transitions, ciphertext range fetches, and proxy
 * request timings.
 *
 * Off by default — it emits several lines per second of playback, which
 * drowns out everything else in the dev console. Flip to `true` to get the
 * full timeline back when investigating slow starts or stalls.
 */
const VIDEO_PERF_LOGGING = false;

const silentLogger: Logger = {
  child: () => silentLogger,
  withContext: () => silentLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Logger for video performance traces. Returns a no-op logger unless
 * `VIDEO_PERF_LOGGING` is on. Warnings and errors that matter regardless of
 * instrumentation must use a regular `createLogger` instance instead.
 */
export function createVideoPerfLogger(namespace: string): Logger {
  return VIDEO_PERF_LOGGING ? createLogger(namespace) : silentLogger;
}
