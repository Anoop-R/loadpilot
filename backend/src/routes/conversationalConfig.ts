import { Router } from "express";
import { buildConversationalConfigPrompt, ConversationMessage } from "../prompts/conversationalConfig";
import { estimateCost } from "../utils/pricing";

const router = Router();

// Maximum messages to send to Groq — keeps the context window manageable.
// We always keep the opening assistant message + the most recent N turns.
const MAX_HISTORY_MESSAGES = 12;

async function callGroqChat(body: object, apiKey: string, retries = 1): Promise<Response> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  // Rate limit — wait and retry once
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get("retry-after") || "8");
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return callGroqChat(body, apiKey, retries - 1);
  }
  return res;
}

// POST /api/ai/converse
router.post("/converse", async (req, res) => {
  try {
    const messages: ConversationMessage[] = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Provide 'messages': conversation history array." });
    }

    // Trim history: keep opening message + last N to stay within token budget
    const trimmed: ConversationMessage[] = messages.length > MAX_HISTORY_MESSAGES
      ? [messages[0], ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))]
      : messages;

    const { system, messages: historyMessages } = buildConversationalConfigPrompt(trimmed);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY not set.");

    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const body = {
      model,
      temperature: 0.4,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        ...historyMessages,
      ],
    };

    const response = await callGroqChat(body, apiKey);

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error("The AI is temporarily rate-limited — too many requests in a short period. Please wait 10–20 seconds and try again.");
      }
      throw new Error(`Groq API error (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? {};

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { type: "question", message: "I had trouble processing that — could you rephrase?" };
    }

    const cost = estimateCost(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
    res.json({
      ...parsed,
      usage: { promptTokens: usage.prompt_tokens ?? 0, completionTokens: usage.completion_tokens ?? 0 },
      cost,
      model,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Conversation failed" });
  }
});

export default router;
