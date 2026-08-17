/**
 * Convex redacts messages of plain server errors on production deployments,
 * so clients receive strings like "[Request ID: …] Server Error". Those are
 * useless in a toast — show the translated fallback instead. Client-side
 * errors (picker permissions, upload preflight) keep their real message.
 */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && !/server error/i.test(error.message)) {
    return error.message;
  }

  return fallback;
}
