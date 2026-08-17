const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>(
  Array.from(BASE64_ALPHABET, (char, index) => [char, index] as const),
);

/** Standard base64 with padding; pure JS so it behaves identically on Hermes, Node, and browsers. */
export function toBase64(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const byte2 = index + 1 < bytes.length ? bytes[index + 1] : undefined;
    const byte3 = index + 2 < bytes.length ? bytes[index + 2] : undefined;

    output += BASE64_ALPHABET[byte1 >> 2];
    output += BASE64_ALPHABET[((byte1 & 0x03) << 4) | ((byte2 ?? 0) >> 4)];
    output += byte2 === undefined ? '=' : BASE64_ALPHABET[((byte2 & 0x0f) << 2) | ((byte3 ?? 0) >> 6)];
    output += byte3 === undefined ? '=' : BASE64_ALPHABET[byte3 & 0x3f];
  }

  return output;
}

export function fromBase64(value: string): Uint8Array {
  const trimmed = value.replace(/=+$/, '');

  if (!/^[A-Za-z0-9+/]*$/.test(trimmed)) {
    throw new Error('Invalid base64 input.');
  }

  const output = new Uint8Array(Math.floor((trimmed.length * 3) / 4));
  let outputIndex = 0;
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const char of trimmed) {
    buffer = (buffer << 6) | (BASE64_LOOKUP.get(char) ?? 0);
    bitsInBuffer += 6;

    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      output[outputIndex] = (buffer >> bitsInBuffer) & 0xff;
      outputIndex += 1;
    }
  }

  return output;
}

/** Pure-JS UTF-8 codec; Hermes lacks a guaranteed TextDecoder. */
export function toUtf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const char of value) {
    const codePoint = char.codePointAt(0)!;

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

export function fromUtf8Bytes(bytes: Uint8Array): string {
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes[index];
    let codePoint: number;
    let extraBytes: number;

    if (byte <= 0x7f) {
      codePoint = byte;
      extraBytes = 0;
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f;
      extraBytes = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f;
      extraBytes = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07;
      extraBytes = 3;
    } else {
      throw new Error('Invalid UTF-8 input.');
    }

    for (let offset = 1; offset <= extraBytes; offset += 1) {
      const continuation = bytes[index + offset];

      if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
        throw new Error('Invalid UTF-8 input.');
      }

      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    output += String.fromCodePoint(codePoint);
    index += extraBytes + 1;
  }

  return output;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

export function constantLengthEquals(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}
