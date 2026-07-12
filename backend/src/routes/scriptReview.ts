import { Router } from "express";
import multer from "multer";
import { lintJmx } from "../utils/jmxParser";
import { buildScriptReviewPrompt } from "../prompts/scriptReview";
import { callGroq, safeParseJson } from "../llm/groqClient";
import { estimateCost } from "../utils/pricing";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// POST /api/script-review/review
// Accepts a multipart file upload (field "jmx") or JSON body { xml: "..." }
router.post("/review", upload.single("jmx"), async (req, res) => {
  try {
    let xml: string | undefined;
    if (req.file) {
      xml = req.file.buffer.toString("utf-8");
    } else if (req.body?.xml) {
      xml = req.body.xml;
    }

    if (!xml) {
      return res.status(400).json({
        error: "Provide a .jmx file (form field 'jmx') or raw XML text (JSON field 'xml').",
      });
    }

    const facts = lintJmx(xml);
    const { system, user } = buildScriptReviewPrompt(facts);
    const result = await callGroq(system, user, { jsonMode: true, temperature: 0.2 });
    const review = safeParseJson(result.content);
    const cost = estimateCost(result.model, result.usage.promptTokens, result.usage.completionTokens);

    res.json({ facts, review, usage: result.usage, cost, model: result.model });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Script review failed" });
  }
});

export default router;
