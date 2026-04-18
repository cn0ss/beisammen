import { WorkOS } from '@workos-inc/node';

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set.`);
  }

  return value.trim();
}

export function getWorkOSClientId(): string {
  return requireEnv('WORKOS_CLIENT_ID');
}

export function getServerWorkOS(): WorkOS {
  return new WorkOS(requireEnv('WORKOS_API_KEY'));
}

export function getPublicWorkOS(): WorkOS {
  return new WorkOS({
    clientId: getWorkOSClientId(),
  });
}

export function readWorkOSRequestMetadata(request: Request) {
  return {
    ipAddress:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
  };
}

export async function authenticateWorkOSCode(input: {
  code: string;
  request: Request;
  codeVerifier?: string;
}) {
  const metadata = readWorkOSRequestMetadata(input.request);
  const clientId = getWorkOSClientId();

  return await getServerWorkOS().userManagement.authenticateWithCode({
    clientId,
    code: input.code,
    ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}),
    ...metadata,
  });
}

export async function refreshWorkOSSession(input: {
  refreshToken: string;
  request: Request;
}) {
  const metadata = readWorkOSRequestMetadata(input.request);

  return await getServerWorkOS().userManagement.authenticateWithRefreshToken({
    clientId: getWorkOSClientId(),
    refreshToken: input.refreshToken,
    ...metadata,
  });
}
