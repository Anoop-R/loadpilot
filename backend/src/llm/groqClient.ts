// Thin wrapper around Groq's OpenAI-compatible chat completions endpoint.
// Node 18+ has global fetch, so no extra HTTP dependency is needed.

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export interface GroqUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GroqResult {
  content: string;
  usage: GroqUsage;
  model: string;
}

export interface CallGroqOptions {
  temperature?: number;
  jsonMode?: boolean;
  model?: string;
}

export async function callGroq(
  systemPrompt: string,
  userPrompt: string,
  opts: CallGroqOptions = {}
): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Copy backend/.env.example to backend/.env and add your key."
    );
  }

  const model = opts.model || DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    temperature: opts.temperature ?? 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as any;
  const choice = data.choices?.[0];
  const content: string = choice?.message?.content ?? "";
  const usage = data.usage ?? {};

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    },
    model,
  };
}

/**
 * Parses LLM output as JSON, tolerating the occasional markdown code fence
 * the model adds even when told not to.
 */
export function safeParseJson<T = any>(raw: string): T {
  let text = raw.trim();
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse LLM JSON output: ${(e as Error).message}\nRaw output (truncated): ${text.slice(
        0,
        500
      )}`
    );
  }
}
