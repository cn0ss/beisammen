const baseUrl = (import.meta.env.PUBLIC_INSTANCE_BASE_URL as string | undefined)?.trim();

function instanceUrl(path: string): string {
  if (!baseUrl) {
    return '';
  }
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return '';
  }
}

export const waitlistEndpoint = instanceUrl('/waitlist/join');
export const publicShareEndpoint = instanceUrl('/public/share/preview');
