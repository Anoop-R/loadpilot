// Parses a plain-English description of a test ("run the api for 4 users at
// the same time with different session id and user id for a minute and end
// it if it fails") into a structured suggestion the frontend can preview and
// let the person confirm/edit before it touches the actual form. This is
// deliberately NOT asked to invent things the person didn't say — if they
// didn't mention a host or path, those come back null/empty rather than
// guessed, since a wrong guess here would be worse than leaving it blank for
// the person to fill in themselves.

export function buildConfigFromDescriptionPrompt(description: string) {
  const system = `You translate a plain-English description of a load test into a structured
JSON suggestion for a no-code JMeter test builder. The person describing the test may not be
technical — they might say things like "4 users at the same time," "different session id and
user id for each person," "run for a minute," "stop if it fails."

Critical rule: ONLY fill in fields the description actually specifies or clearly implies. If
the description doesn't mention a target host, path, method, headers, or body, leave those
fields null/empty — do NOT invent a plausible-looking placeholder. A wrong guess is worse than
an honest blank, since the person will review this before it's applied to anything.

How to interpret common phrasings:
- "N users at the same time" / "N concurrent users" -> users = N
- "for X minute(s)/second(s)" -> durationSeconds (convert minutes to seconds)
- "different X and Y per user" / "each user has their own X" -> these become candidate CSV
  variable names (e.g. "session id" -> "session_id", "user id" -> "user_id") to suggest, since
  per-user varying values come from an uploaded CSV in this tool, which the LLM cannot generate
  on its own — surface them as suggestedCsvVariables and explain in the notes that the person
  still needs to generate or upload that CSV (the app's Test Data Generator tool can do this).
- "stop if it fails" / "end it if it fails" -> ambiguous between stopping just that one user's
  session or stopping the whole test; when ambiguous, default to "stopthread" (stop just that
  user) as the safer interpretation, but say so explicitly in the notes and mention the
  alternative ("stoptest"/"stoptestnow") exists if they meant the whole run.
- "ramp up over X seconds" -> rampUpSeconds; if not mentioned, leave null (the form already has
  a sensible default the person can keep).
- A specific endpoint, URL, method, header, or body mentioned by name or example -> fill those
  fields in directly.

Respond ONLY with valid JSON, no markdown fences, no commentary, matching exactly this shape
(use null for anything not specified, not empty string):
{
  "config": {
    "testName": "string or null",
    "protocol": "https" | "http" | null,
    "domain": "string or null",
    "port": number or null,
    "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | null,
    "path": "string or null",
    "headers": [{"name": "string", "value": "string"}],
    "body": "string or null",
    "expectedStatusCode": "string or null",
    "maxResponseTimeMs": number or null,
    "users": number or null,
    "rampUpSeconds": number or null,
    "durationSeconds": number or null,
    "thinkTimeMs": number or null,
    "onError": "continue" | "stopthread" | "stoptest" | "stoptestnow" | null,
    "suggestedCsvVariables": ["string", "..."]
  },
  "notes": "string — 2-4 plain-English sentences summarizing what was understood, calling out any assumption made (like the stopthread/stoptest interpretation), and clearly stating what the person still needs to fill in themselves (e.g. target host/path, or uploading a CSV for the suggested variables)"
}`;

  const user = `Description: "${description}"`;
  return { system, user };
}
