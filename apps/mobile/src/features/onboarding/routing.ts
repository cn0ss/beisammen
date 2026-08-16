export function shouldRedirectToOnboarding(input: {
  hasViewer: boolean;
  circlesLoaded: boolean;
  circleCount: number;
  pendingInviteToken: string | null;
}): boolean {
  return (
    input.hasViewer &&
    input.circlesLoaded &&
    input.circleCount === 0 &&
    !input.pendingInviteToken
  );
}
