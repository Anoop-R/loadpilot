import { Router } from "express";
import multer from "multer";
import { parseJtlCsv, aggregateByLabel } from "../utils/jtlParser";
import { buildResultsAnalysisPrompt } from "../prompts/resultsAnalysis";
import { callGroq, safeParseJson } from "../llm/groqClient";
import { estimateCost } from "../utils/pricing";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// POST /api/results-analysis/analyze
// Accepts either a multipart file upload (field "jtl") or a JSON body { csv: "..." }
router.post("/analyze", upload.single("jtl"), async (req, res) => {
  try {
    let csv: string | undefined;
    if (req.file) {
      csv = req.file.buffer.toString("utf-8");
    } else if (req.body?.csv) {
      csv = req.body.csv;
    }

    if (!csv) {
      return res.status(400).json({
        error: "Provide a .jtl file (form field 'jtl') or raw CSV text (JSON field 'csv').",
      });
    }

    const rows = parseJtlCsv(csv);
    if (rows.length === 0) {
      return res.status(400).json({
        error:
          "Could not parse any rows. Make sure this is a JMeter JTL in CSV format with a header row.",
      });
    }

    const goodMs = Number(req.body?.goodMs);
    const moderateMs = Number(req.body?.moderateMs);
    const thresholds =
      Number.isFinite(goodMs) && Number.isFinite(moderateMs) && goodMs > 0 && moderateMs > goodMs
        ? { goodMs, moderateMs }
        : undefined;

    const stats = aggregateByLabel(rows, undefined, thresholds);
    const { system, user } = buildResultsAnalysisPrompt(stats, thresholds);
    const result = await callGroq(system, user, { jsonMode: true, temperature: 0.2 });
    const analysis = safeParseJson(result.content);
    const cost = estimateCost(result.model, result.usage.promptTokens, result.usage.completionTokens);

    res.json({ stats, analysis, usage: result.usage, cost, model: result.model });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Analysis failed" });
  }
});

export default router;
