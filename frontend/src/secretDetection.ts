// Frontend mirror of backend/src/reports/secretDetection.ts — used here for
// the instant, client-side "this looks like a secret, mark it sensitive?"
// warning before Run/Generate, without a network round trip. Keep both
// copies of these patterns in sync if you change one.
//
// Honest limitation: regex-based pattern matching, not a real secret
// scanner. Catches common cases (connection strings, API keys, tokens,
// password-shaped JSON fields), will have both false positives and false
// negatives. A safety net, not a guarantee.

const SENSITIVE_HEADER_NAME =
  /\b(api[_-]?key|secret|password|token|auth(orization)?|x-session-id|session[_-]?id|client[_-]?secret)\b/i;

const CONNECTION_STRING = /[a-z][a-z0-9+.-]*:\/\/[^/\s:"]+:[^/\s@"]+@[^/\s"]+/gi;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SECRET_JSON_FIELD = /"(password|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret)"\s*:\s*"([^"]+)"/gi;

export function detectSensitiveHeaderNames(headers: { name: string; value: string }[]): string[] {
  return headers.filter((h) => h.value?.trim() && SENSITIVE_HEADER_NAME.test(h.name)).map((h) => h.name);
}

export function detectSensitiveBodyValues(body: string | undefined): string[] {
  if (!body) return [];
  const found = new Set<string>();
  for (const m of body.matchAll(CONNECTION_STRING)) found.add(m[0]);
  for (const m of body.matchAll(AWS_ACCESS_KEY)) found.add(m[0]);
  for (const m of body.matchAll(JWT_LIKE)) found.add(m[0]);
  for (const m of body.matchAll(SECRET_JSON_FIELD)) found.add(m[2]);
  return Array.from(found);
}
