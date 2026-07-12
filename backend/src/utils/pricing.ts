// Rough Groq pricing per 1M tokens (USD), used only to show an estimated cost
// per request. Update these numbers if Groq's published pricing changes.
const PRICING: Record<string, { input: number; output: number }> = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rate = PRICING[model] || PRICING["llama-3.3-70b-versatile"];
  const cost =
    (promptTokens / 1_000_000) * rate.input +
    (completionTokens / 1_000_000) * rate.output;
  return Number(cost.toFixed(6));
}
