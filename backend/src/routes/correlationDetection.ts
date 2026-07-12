import { Router } from "express";
import { buildCorrelationPrompt } from "../prompts/correlationDetection";
import { callGroq, safeParseJson } from "../llm/groqClient";
import { estimateCost } from "../utils/pricing";

const router = Router();

// POST /api/correlation/detect
// Body: { transactions: string } — raw recorded request/response text, in order.
router.post("/detect", async (req, res) => {
  try {
    const transactions: string | undefined = req.body?.transactions;
    if (!transactions || transactions.trim().length === 0) {
      return res.status(400).json({
        error: "Provide 'transactions': the recorded request/response text, in order.",
      });
    }

    const { system, user } = buildCorrelationPrompt(transactions);
    const result = await callGroq(system, user, { jsonMode: true, temperature: 0.2 });
    const correlations = safeParseJson(result.content);
    const cost = estimateCost(result.model, result.usage.promptTokens, result.usage.completionTokens);

    res.json({ ...correlations, usage: result.usage, cost, model: result.model });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Correlation detection failed" });
  }
});

export default router;
