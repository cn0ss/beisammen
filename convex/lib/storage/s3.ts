import type {
  ConnectionCheck,
  InstanceStorageStatus,
  SignedReadUrl,
  S3StorageReference,
  UploadTarget,
} from '@beisammen/contracts';

import {
  buildS3BucketUrl,
  buildS3Url,
  getS3AccessKeyId,
  getS3Region,
  getS3SecretAccessKey,
} from './shared';

const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return toHex(digest);
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return await crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(value));
}

async function signingKey(secretAccessKey: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(textEncoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, 's3');
  return await hmacRaw(kService, 'aws4_request');
}

function isoTimestamp(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');

  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

async function presignRequest(input: {
  url: URL;
  region: string;
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  expiresInSeconds: number;
  extraHeaders?: Record<string, string>;
}): Promise<{
  url: string;
  expiresAt: number;
}> {
  const now = new Date();
  const { amzDate, dateStamp } = isoTimestamp(now);
  const accessKeyId = getS3AccessKeyId();
  const secretAccessKey = getS3SecretAccessKey();
  const url = new URL(input.url.toString());
  const host = url.host;
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const signedHeaderNames = ['host'];
  const headers: Record<string, string> = {
    host,
    ...(input.extraHeaders ?? {}),
  };

  if (input.extraHeaders) {
    for (const key of Object.keys(input.extraHeaders)) {
      signedHeaderNames.push(key.toLowerCase());
    }
  }

  signedHeaderNames.sort();

  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`);
  url.searchParams.set('X-Amz-Date', amzDate);
  url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
  url.searchParams.set('X-Amz-SignedHeaders', signedHeaderNames.join(';'));

  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name] ?? ''}`.trim())
    .join('\n');
  const canonicalQueryString = (Array.from(url.searchParams.entries()) as [string, string][])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQueryString,
    `${canonicalHeaders}\n`,
    signedHeaderNames.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = toHex(
    await hmacRaw(await signingKey(secretAccessKey, dateStamp, input.region), stringToSign),
  );

  url.searchParams.set('X-Amz-Signature', signature);

  return {
    url: url.toString(),
    expiresAt: Date.now() + input.expiresInSeconds * 1000,
  };
}

export async function createS3UploadTarget(input: {
  storage: S3StorageReference;
  mimeType: string;
  /**
   * Exact declared byte size of the upload. Signed into the presigned PUT as
   * `content-length`, so the storage provider rejects any PUT whose size
   * differs from the declaration (SigV4 signature mismatch).
   */
  sizeBytes: number;
}): Promise<UploadTarget> {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error('Upload targets require a positive declared size.');
  }

  const signedHeaders = {
    'content-length': String(input.sizeBytes),
    'content-type': input.mimeType,
  };
  const target = await presignRequest({
    url: buildS3Url(input.storage),
    region: getS3Region(input.storage),
    method: 'PUT',
    expiresInSeconds: 15 * 60,
    extraHeaders: signedHeaders,
  });

  return {
    provider: 's3',
    method: 'PUT',
    uploadUrl: target.url,
    objectKey: input.storage.objectKey,
    expiresAt: target.expiresAt,
    headers: signedHeaders,
  };
}

export async function createS3ReadUrl(input: {
  storage: S3StorageReference;
}): Promise<SignedReadUrl> {
  const target = await presignRequest({
    url: buildS3Url(input.storage),
    region: getS3Region(input.storage),
    method: 'GET',
    expiresInSeconds: 5 * 60,
  });

  return {
    url: target.url,
    expiresAt: target.expiresAt,
  };
}

export async function verifyS3ObjectExists(input: {
  storage: S3StorageReference;
}): Promise<{ sizeBytes: number }> {
  const target = await presignRequest({
    url: buildS3Url(input.storage),
    region: getS3Region(input.storage),
    method: 'HEAD',
    expiresInSeconds: 60,
  });
  const response = await fetch(target.url, {
    method: 'HEAD',
  });

  if (response.ok) {
    const contentLength = response.headers.get('content-length');
    const sizeBytes = contentLength ? Number(contentLength) : Number.NaN;

    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new Error('S3 object verification did not return a valid content length.');
    }

    return {
      sizeBytes,
    };
  }

  if (response.status === 404) {
    throw new Error('Uploaded S3 object was not found.');
  }

  throw new Error(`S3 object verification failed with status ${response.status}.`);
}

export async function deleteS3Object(input: {
  storage: S3StorageReference;
}): Promise<void> {
  const target = await presignRequest({
    url: buildS3Url(input.storage),
    region: getS3Region(input.storage),
    method: 'DELETE',
    expiresInSeconds: 60,
  });
  const response = await fetch(target.url, {
    method: 'DELETE',
  });

  if (response.ok || response.status === 204 || response.status === 404) {
    return;
  }

  throw new Error(`S3 object deletion failed with status ${response.status}.`);
}

export async function validateCurrentS3Configuration(
  storage: InstanceStorageStatus,
): Promise<ConnectionCheck> {
  if (storage.providerKind !== 's3' || !storage.bucket) {
    return {
      ok: false,
      message: 'S3 ist für diese Instanz nicht konfiguriert.',
    };
  }

  try {
    const target = await presignRequest({
      url: buildS3BucketUrl({
        bucket: storage.bucket,
        ...(storage.region ? { region: storage.region } : {}),
        ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
      }),
      region: storage.region?.trim() || 'us-east-1',
      method: 'HEAD',
      expiresInSeconds: 60,
    });
    const response = await fetch(target.url, {
      method: 'HEAD',
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `S3 Prüfung für Bucket ${storage.bucket} schlug mit Status ${response.status} fehl.`,
      };
    }

    return {
      ok: true,
      message: `S3 Verbindung und Signierung für Bucket ${storage.bucket} sind aktiv.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'S3 Prüfung ist fehlgeschlagen.',
    };
  }
}
