import { describe, expect, test } from 'vitest';

import { parseInviteToken } from '@/features/invites/parse-invite-token';

describe('parseInviteToken', () => {
  test('accepts a raw token', () => {
    expect(parseInviteToken('  abc123  ')).toBe('abc123');
  });

  test('extracts the token from a connect link', () => {
    expect(parseInviteToken('beisammen://connect?invite=abc123')).toBe('abc123');
    expect(
      parseInviteToken('beisammen://connect?instance=https%3A%2F%2Fhome.example.com&invite=tok-1'),
    ).toBe('tok-1');
  });

  test('extracts the link from a pasted share message', () => {
    expect(
      parseInviteToken('Komm in meinen Circle "Familie": beisammen://connect?invite=xyz\n\nBis bald!'),
    ).toBe('xyz');
  });

  test('rejects unrelated URLs and empty input', () => {
    expect(parseInviteToken('https://example.com/some-page')).toBeNull();
    expect(parseInviteToken('   ')).toBeNull();
    expect(parseInviteToken('zwei wörter ohne link')).toBeNull();
  });
});
