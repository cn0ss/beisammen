/**
 * Accepts a raw invite token, a `beisammen://connect?invite=...` link, or a
 * pasted share message containing such a link.
 */
export function parseInviteToken(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const paramMatch = trimmed.match(/[?&]invite=([^&\s]+)/);

  if (paramMatch?.[1]) {
    try {
      return decodeURIComponent(paramMatch[1]);
    } catch {
      return paramMatch[1];
    }
  }

  if (/\s/.test(trimmed)) {
    const linkMatch = trimmed.match(/beisammen:\/\/\S+/);
    return linkMatch ? parseInviteToken(linkMatch[0]) : null;
  }

  if (trimmed.includes('://')) {
    return null;
  }

  return trimmed;
}
