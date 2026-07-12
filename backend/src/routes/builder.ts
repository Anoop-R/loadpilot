import { Router } from "express";
import multer from "multer";
import { generateJmxOnly } from "../runs/runManager";
import { BuildConfig } from "../builders/jmxBuilder";
import { detectJmeter } from "../runs/jmeterDetect";
import { runCorrelationProbe } from "../runs/correlationProbe";
import { buildConfigFromDescriptionPrompt } from "../prompts/configFromDescription";
import { callGroq, safeParseJson } from "../llm/groqClient";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/builder/jmeter-status
router.get("/jmeter-status", async (_req, res) => {
  try {
    const status = await detectJmeter();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ available: false, error: err.message || "Failed to check JMeter status" });
  }
});

// POST /api/builder/generate
// multipart form: "config" (JSON string matching BuildConfig), optional "csv" file
router.post("/generate", upload.single("csv"), (req, res) => {
  try {
    const config: BuildConfig = JSON.parse(req.body.config);
    if (req.file) {
      const header = req.file.buffer.toString("utf-8").split(/\r?\n/)[0] || "";
      config.csv = {
        ...config.csv,
        filename: "data.csv",
        variableNames: header.split(",").map((h) => h.trim()),
      };
    }
    const xml = generateJmxOnly(config);
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${(config.testName || "plan").replace(/[^a-z0-9-_]/gi, "_")}.jmx"`);
    res.send(xml);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate .jmx" });
  }
});

// POST /api/builder/auto-correlate
// multipart form: "config" (JSON string matching BuildConfig), optional "csv" file
router.post("/auto-correlate", upload.single("csv"), async (req, res) => {
  try {
    const config: BuildConfig = JSON.parse(req.body.config);
    let csv: { filename: string; buffer: Buffer } | undefined;
    if (req.file) {
      const header = req.file.buffer.toString("utf-8").split(/\r?\n/)[0] || "";
      config.csv = {
        ...config.csv,
        filename: "data.csv",
        variableNames: header.split(",").map((h) => h.trim()),
      };
      csv = { filename: "data.csv", buffer: req.file.buffer };
    }
    const result = await runCorrelationProbe(config, csv);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Auto-correlation failed" });
  }
});

// POST /api/builder/parse-description
// body: { description: string }
// Returns a structured suggestion for the frontend to preview — never applied automatically.
router.post("/parse-description", async (req, res) => {
  try {
    const description: string | undefined = req.body?.description;
    if (!description?.trim()) {
      return res.status(400).json({ error: "Provide a 'description' of what you want to test." });
    }
    const { system, user } = buildConfigFromDescriptionPrompt(description.trim());
    const result = await callGroq(system, user, { jsonMode: true, temperature: 0.2 });
    const parsed = safeParseJson(result.content);
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to parse description" });
  }
});

export default router;
