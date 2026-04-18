export interface AuthIdentity {
  provider: 'workos';
  subject: string;
  email?: string;
  name?: string;
  sessionId?: string;
}

export function isAuthIdentity(value: unknown): value is AuthIdentity {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const identity = value as AuthIdentity;

  return (
    identity.provider === 'workos' && typeof identity.subject === 'string'
  );
}
