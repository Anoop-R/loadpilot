// Pattern-based detection of values that are likely secrets — connection
// strings, API keys, tokens, password-shaped JSON fields, JWT-shaped tokens,
// and header names that conventionally carry credentials (Authorization,
// x-api-key, etc). This is a SUGGESTION mechanism only: it's used to (a)
// auto-mask in the "external" HTML report export regardless of whether
// something was manually flagged sensitive, and (b) (mirrored in the
// frontend) warn before Run/Generate if something looks like a secret and
// wasn't manually marked. It never silently overrides a person's explicit
// choice to leave something unmasked in the "internal" export.
//
// Honest limitation: this is regex-based pattern matching, not a real secret
// scanner — it will have both false positives (flagging something that
// isn't actually sensitive) and false negatives (missing an unusual secret
// format). It's a safety net for the common cases, not a guarantee.
//
// IMPORTANT: this logic is duplicated in frontend/src/secretDetection.ts for
// the pre-run warning (the frontend needs it client-side, instantly, without
// a network round trip — there's no shared package between the two npm
// projects in this layout). Keep both copies in sync if you change the
// patterns here.

const SENSITIVE_HEADER_NAME = /\b(api[_-]?key|secret|password|token|auth(orization)?|x-session-id|session[_-]?id|client[_-]?secret)\b/i;

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
