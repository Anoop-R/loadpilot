import { Router } from "express";
import { buildTestDataPrompt, TestDataField, TestDataSample } from "../prompts/testDataGenerator";
import { callGroq, safeParseJson } from "../llm/groqClient";
import { estimateCost } from "../utils/pricing";

const router = Router();

const CHUNK_SIZE = 100;
const MAX_ROWS = 1000;

function rowsToCsv(fields: TestDataField[], rows: Record<string, any>[]): string {
  const headers = fields.map((f) => f.name);
  const escape = (v: any) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

// POST /api/test-data/generate
// Body: { fields, count, sample?: { requestBody?, responseBody?, notes? } }
router.post("/generate", async (req, res) => {
  try {
    const fields: TestDataField[] = req.body?.fields;
    let count: number = Number(req.body?.count);
    const sample: TestDataSample | undefined = req.body?.sample;

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: "Provide 'fields': a non-empty array of { name, type?, description? }." });
    }
    if (!count || count <= 0) {
      return res.status(400).json({ error: "Provide a positive 'count'." });
    }
    if (count > MAX_ROWS) count = MAX_ROWS;

    const allRows: Record<string, any>[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let model = "";

    for (let start = 0; start < count; start += CHUNK_SIZE) {
      const batchSize = Math.min(CHUNK_SIZE, count - start);
      // Only pass sample data on the first chunk — subsequent chunks use the
      // same field definitions but don't need to re-analyse the sample
      const { system, user } = buildTestDataPrompt(fields, batchSize, start, start === 0 ? sample : undefined);
      const result = await callGroq(system, user, { jsonMode: true, temperature: 0.8 });
      const parsed = safeParseJson<{ rows: Record<string, any>[] }>(result.content);
      const batch = parsed.rows;
      if (!Array.isArray(batch)) throw new Error("LLM did not return a JSON array for a data batch.");
      allRows.push(...batch);
      totalPromptTokens += result.usage.promptTokens;
      totalCompletionTokens += result.usage.completionTokens;
      model = result.model;
    }

    const csv = rowsToCsv(fields, allRows);
    const cost = estimateCost(model, totalPromptTokens, totalCompletionTokens);

    res.json({
      rows: allRows,
      csv,
      requested: Number(req.body?.count),
      generated: allRows.length,
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
      cost,
      model,
      cappedAt: Number(req.body?.count) > MAX_ROWS ? MAX_ROWS : undefined,
      learnedFromSample: Boolean(sample?.requestBody || sample?.responseBody),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Test data generation failed" });
  }
});

export default router;
