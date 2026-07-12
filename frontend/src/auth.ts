const STORAGE_KEY = "loadpilot_auth";

export interface AuthState {
  username: string;
  token: string;
}

let current: AuthState | null = null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) current = JSON.parse(raw);
} catch {
  current = null;
}

export function getAuth(): AuthState | null {
  return current;
}

export function setAuth(auth: AuthState | null) {
  current = auth;
  try {
    if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable — auth just won't survive a refresh, not fatal */
  }
}

/** Merge into fetch() headers for any request that should be tagged with who's signed in. */
export function authHeaders(): Record<string, string> {
  return current ? { "X-Session-Token": current.token } : {};
}
