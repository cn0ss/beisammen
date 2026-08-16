export type InviteMode = 'email' | 'open';
export type InviteRole = 'admin' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface InvitePreviewLike {
  mode: InviteMode;
  invitedEmail: string | null;
  status: InviteStatus;
  canAccept: boolean;
  emailMatchesViewer: boolean;
  isAlreadyMember: boolean;
}

export type InvitePreviewState =
  | { kind: 'loading'; title: string }
  | { kind: 'not-found'; title: string }
  | { kind: 'can-accept'; title: string }
  | { kind: 'already-member'; title: string }
  | { kind: 'email-mismatch'; title: string }
  | { kind: 'consumed'; title: string }
  | { kind: 'expired'; title: string }
  | { kind: 'revoked'; title: string }
  | { kind: 'blocked'; title: string };

export function inviteModeLabel(mode: InviteMode): string {
  return mode === 'open' ? 'Offener Einmal-Link' : 'Persönlicher E-Mail-Link';
}

export function inviteRoleLabel(role: InviteRole): string {
  return role === 'admin' ? 'Admin' : 'Mitglied';
}

export function buildInviteShareMessage(input: {
  circleName: string;
  inviteLink: string;
  mode: InviteMode;
}): string {
  const intro = `Komm in meinen Circle "${input.circleName}": ${input.inviteLink}`;

  if (input.mode === 'open') {
    return `${intro}\n\nDieser Link ist einmalig nutzbar.`;
  }

  return `${intro}\n\nDieser persönliche Link ist nur für die eingeladene E-Mail gedacht.`;
}

export function resolveInvitePreviewState(input: {
  preview: InvitePreviewLike | null | undefined;
}): InvitePreviewState {
  const preview = input.preview;

  if (preview === undefined) {
    return { kind: 'loading', title: 'Einladung wird geladen' };
  }

  if (preview === null) {
    return { kind: 'not-found', title: 'Einladung nicht gefunden' };
  }

  if (preview.isAlreadyMember && preview.status === 'pending') {
    return { kind: 'already-member', title: 'Du bist schon Mitglied' };
  }

  switch (preview.status) {
    case 'accepted':
      return { kind: 'consumed', title: 'Einladung wurde bereits verwendet' };
    case 'expired':
      return { kind: 'expired', title: 'Einladung ist abgelaufen' };
    case 'revoked':
      return { kind: 'revoked', title: 'Einladung wurde zurückgezogen' };
    default:
      break;
  }

  if (!preview.emailMatchesViewer) {
    return { kind: 'email-mismatch', title: 'E-Mail passt nicht' };
  }

  if (preview.canAccept) {
    return { kind: 'can-accept', title: 'Einladung annehmen' };
  }

  return { kind: 'blocked', title: 'Einladung kann nicht angenommen werden' };
}
