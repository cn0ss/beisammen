/**
 * Minimal HTTP/1.1 support for the local video proxy: exactly what native
 * video players need (GET/HEAD with an optional single Range header) and
 * nothing more. The proxy always answers `Connection: close`, so no
 * keep-alive or pipelining handling is required.
 */

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
}

const HEADER_TERMINATOR = [0x0d, 0x0a, 0x0d, 0x0a]; // \r\n\r\n
const MAX_REQUEST_HEAD_BYTES = 16 * 1024;

function findHeaderEnd(buffer: Uint8Array): number {
  outer: for (let index = 0; index + HEADER_TERMINATOR.length <= buffer.length; index += 1) {
    for (let offset = 0; offset < HEADER_TERMINATOR.length; offset += 1) {
      if (buffer[index + offset] !== HEADER_TERMINATOR[offset]) {
        continue outer;
      }
    }

    return index;
  }

  return -1;
}

function asciiDecode(bytes: Uint8Array): string {
  let output = '';

  for (const byte of bytes) {
    output += String.fromCharCode(byte);
  }

  return output;
}

export function asciiEncode(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }

  return bytes;
}

/**
 * Returns the parsed request head once fully received, `null` while
 * incomplete. Throws on malformed input or oversized heads.
 */
export function tryParseRequestHead(buffer: Uint8Array): HttpRequest | null {
  const headerEnd = findHeaderEnd(buffer);

  if (headerEnd < 0) {
    if (buffer.length > MAX_REQUEST_HEAD_BYTES) {
      throw new Error('HTTP request head is too large.');
    }

    return null;
  }

  const head = asciiDecode(buffer.subarray(0, headerEnd));
  const [requestLine, ...headerLines] = head.split('\r\n');
  const requestParts = requestLine.split(' ');

  if (requestParts.length < 3) {
    throw new Error('Malformed HTTP request line.');
  }

  const headers: Record<string, string> = {};

  for (const line of headerLines) {
    const separator = line.indexOf(':');

    if (separator <= 0) {
      continue;
    }

    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }

  return {
    method: requestParts[0].toUpperCase(),
    path: requestParts[1],
    headers,
  };
}

/** Inclusive byte range within a resource of known total length. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a `Range` header. Returns `null` when absent/ignorable (serve 200),
 * `'unsatisfiable'` for ranges outside the resource (serve 416), otherwise
 * the clamped inclusive range. Only the first range of a multi-range request
 * is honored, which every media player accepts.
 */
export function parseRangeHeader(
  value: string | undefined,
  totalLength: number,
): ByteRange | 'unsatisfiable' | null {
  if (!value) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)(?:,|$)/.exec(value.trim());

  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;

  if (rawStart === '' && rawEnd === '') {
    return null;
  }

  if (rawStart === '') {
    // Suffix range: the final N bytes.
    const suffixLength = Number(rawEnd);

    if (suffixLength === 0 || totalLength === 0) {
      return 'unsatisfiable';
    }

    return {
      start: Math.max(0, totalLength - suffixLength),
      end: totalLength - 1,
    };
  }

  const start = Number(rawStart);

  if (start >= totalLength) {
    return 'unsatisfiable';
  }

  const end = rawEnd === '' ? totalLength - 1 : Math.min(Number(rawEnd), totalLength - 1);

  if (end < start) {
    return 'unsatisfiable';
  }

  return { start, end };
}

export function formatResponseHead(
  status: number,
  statusText: string,
  headers: Record<string, string | number>,
): Uint8Array {
  const lines = [`HTTP/1.1 ${status} ${statusText}`];

  for (const [name, value] of Object.entries(headers)) {
    lines.push(`${name}: ${value}`);
  }

  lines.push('Connection: close', '', '');

  return asciiEncode(lines.join('\r\n'));
}
