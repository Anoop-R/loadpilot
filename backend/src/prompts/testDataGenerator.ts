export interface TestDataField {
  name: string;
  type?: string;
  description?: string;
}

export interface TestDataSample {
  requestBody?: string;   // real request body from a working API call
  responseBody?: string;  // real response body from a working API call
  notes?: string;         // anything extra the user wants the AI to know
}

export function buildTestDataPrompt(
  fields: TestDataField[],
  batchSize: number,
  startIndex: number,
  sample?: TestDataSample
) {
  const fieldDocs = fields
    .map((f) => `- ${f.name}${f.type ? ` (${f.type})` : ""}${f.description ? `: ${f.description}` : ""}`)
    .join("\n");

  const sampleSection = sample
    ? `\nREAL API SAMPLE PROVIDED — study these carefully before generating:
${sample.requestBody ? `\nReal request body from a working call:\n${sample.requestBody}` : ""}
${sample.responseBody ? `\nReal response body from that call:\n${sample.responseBody}` : ""}
${sample.notes ? `\nAdditional context from the user:\n${sample.notes}` : ""}

From this sample, infer:
- Exact ID formats (if user_id looks like "user_001", follow that pattern exactly — not random numbers)
- String formats (session IDs, tokens, UUIDs — match the real format)
- Valid query/value ranges visible in the sample
- Any relationships between fields (e.g. if the request has a session_id that appears to belong
  to a specific user_id, keep that pairing logical across rows)
- Any domain-specific values (database names, application names, scope fields) — vary them
  realistically, not randomly
Field descriptions below override sample inferences when they conflict.\n`
    : "";

  const system = `You generate realistic, varied synthetic test data for load testing JMeter
scripts (to be used in a CSV Data Set Config).
${sampleSection}
Rules:
- Generate exactly ${batchSize} rows.
- Fields per row:\n${fieldDocs}
- Values must be realistic and VARIED — no two rows identical, no lazy sequential patterns unless
  a field explicitly calls for a sequence.
- Respect any constraints mentioned in field descriptions (ranges, formats, enums, locales).
- If a sample was provided, match the real data patterns as closely as possible — the goal is
  data that the actual API will accept and process correctly, not just data that looks plausible.
- If an id-like field is requested, continue any implied sequence starting around index ${startIndex}.
- Respond ONLY with valid JSON, no markdown fences, no commentary, matching exactly this shape:
{ "rows": [ { /* one object per row, keys exactly matching the field names given, in the same case */ } ] }
  The "rows" array must contain exactly ${batchSize} objects.`;

  const user = `Generate the batch now.`;
  return { system, user };
}
