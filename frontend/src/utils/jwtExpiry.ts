/**
 * Detects JWT tokens in header values and checks if they expire
 * before a test of the given duration would finish.
 * Returns a warning string if expiry is imminent, null otherwise.
 */

export function checkJwtExpiry(
  headers: { name: string; value: string }[],
  durationSeconds: number
): string | null {
  const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/;

  for (const h of headers) {
    const match = h.value.match(JWT_PATTERN);
    if (!match) continue;

    try {
      // Decode the payload (second segment)
      const payload = JSON.parse(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) continue;

      const expiresAt = new Date(payload.exp * 1000);
      const testEndsAt = new Date(Date.now() + (durationSeconds + 60) * 1000); // +60s buffer

      if (expiresAt < testEndsAt) {
        const minsLeft = Math.round((expiresAt.getTime() - Date.now()) / 60000);
        if (minsLeft < 0) {
          return `The JWT in "${h.name}" has already expired. The test will fail immediately — refresh the token first.`;
        }
        if (minsLeft < (durationSeconds / 60) + 2) {
          return `The JWT in "${h.name}" expires in ~${minsLeft} minute${minsLeft === 1 ? "" : "s"} but your test runs for ${Math.ceil(durationSeconds / 60)} minute${Math.ceil(durationSeconds / 60) === 1 ? "" : "s"}. Refresh the token before running.`;
        }
      }
    } catch {
      // Not a valid JWT or couldn't decode — ignore
    }
  }
  return null;
}
