export interface AutoCorrelation {
  variableName: string;
  foundInStep: number;
  regex: string;
  usedInStep: number;
  usedInDescription: string;
}

/**
 * Unlike the standalone Correlation Detection tool's prompt (which can
 * suggest either a JSON Extractor or a Regular Expression Extractor, for a
 * person manually building a script), this one only ever asks for a regex —
 * that's the only extraction mechanism jmxBuilder.ts can currently apply
 * automatically (see its notes on why: JSON Extractor wasn't available to
 * verify against real JMeter bytecode). It also asks for structured step
 * numbers rather than free-text descriptions, so the result can be applied
 * directly to the right step without needing to fuzzy-match text.
 */
export function buildAutoCorrelationPrompt(transactions: string, stepLabels: string[]) {
  const numberedLabels = stepLabels.map((l, i) => `[${i + 1}] ${l}`).join(", ");

  const system = `You are a JMeter scripting expert. You will be given a sequence of recorded
HTTP requests and responses captured from one real pass through a multi-step test flow, in
order. The steps are: ${numberedLabels}.

Task: find values that appear in one step's response and are reused in a LATER step's request
(session tokens, CSRF tokens, IDs, server-issued timestamps, etc).

For each correlation found:
- a short variable name valid as a JMeter variable (letters, numbers, underscores only)
- foundInStep: the step number (from the list above) where the value appears in the RESPONSE
- regex: a regex with EXACTLY ONE capture group that extracts it from that step's response body
- usedInStep: the step number that reuses it in its REQUEST
- usedInDescription: a short note on where exactly (e.g. "Authorization header", "request body
  field 'sessionId'")

Only report correlations you can actually see evidenced in the text given — never invent one
that isn't really there. If nothing is reused between steps, return an empty array.

Respond ONLY with valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "correlations": [
    { "variableName": "string", "foundInStep": number, "regex": "string", "usedInStep": number, "usedInDescription": "string" }
  ]
}`;

  const user = `Recorded transactions, in order:\n\n${transactions}`;
  return { system, user };
}
