// Deliberately simple: an in-memory map from session token to username.
// Sessions reset if the backend restarts (everyone just signs in again) —
// a reasonable tradeoff for an internal tool, avoiding the complexity of
// JWT signing/verification or a persisted session store for what's really
// just "remember who's currently using the app."

import { randomUUID } from "crypto";

const sessions = new Map<string, string>(); // token -> username

export function createSession(username: string): string {
  const token = randomUUID();
  sessions.set(token, username);
  return token;
}

export function getUsernameForToken(token: string | undefined | null): string | null {
  if (!token) return null;
  return sessions.get(token) || null;
}

export function destroySession(token: string | undefined | null) {
  if (token) sessions.delete(token);
}

/** Pulls the session token out of the custom header this app uses, if present. */
export function extractToken(req: { headers: Record<string, unknown> }): string | undefined {
  const value = req.headers["x-session-token"];
  return typeof value === "string" ? value : undefined;
}
