import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { createRun, listRuns, getRun, stopRun, getRunFilePath, deleteRun, labelRun } from "../runs/runManager";
import { BuildConfig } from "../builders/jmxBuilder";
import { extractToken, getUsernameForToken } from "../auth/sessions";
import { buildRunReportHtml } from "../reports/htmlReport";
import { parseJtlCsv } from "../utils/jtlParser";

import streamRouter from "./stream";

const router = Router();
router.use("/:id/stream", (req: any, _res, next) => {
  if (!req.params.id) req.params = { ...req.params, id: req.params[0] };
  next();
}, streamRouter);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/runs
// multipart form: "config" (JSON string matching BuildConfig), optional "csv" file
router.post("/", upload.single("csv"), async (req, res) => {
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
    const createdBy = getUsernameForToken(extractToken(req)) || undefined;
    const record = await createRun(config, csv, createdBy);
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create run" });
  }
});

// GET /api/runs
router.get("/", async (_req, res) => {
  try {
    res.json(await listRuns());
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to list runs" });
  }
});

// GET /api/runs/:id
router.get("/:id", async (req, res) => {
  try {
    const record = await getRun(req.params.id);
    if (!record) return res.status(404).json({ error: "Run not found" });
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load run" });
  }
});

// POST /api/runs/:id/stop
router.post("/:id/stop", (req, res) => {
  const ok = stopRun(req.params.id);
  if (!ok) return res.status(400).json({ error: "Run is not running or queued" });
  res.json({ ok: true });
});

// GET /api/runs/:id/download/:type   type = jmx | jtl
router.get("/:id/download/:type", (req, res) => {
  const type = req.params.type;
  if (type !== "jmx" && type !== "jtl") return res.status(400).json({ error: "type must be jmx or jtl" });
  const file = getRunFilePath(req.params.id, type);
  if (!file) return res.status(404).json({ error: "File not found for this run" });
  res.download(file, type === "jmx" ? "plan.jmx" : "results.jtl");
});

// GET /api/runs/:id/report.html?mode=internal|external — standalone, self-contained
// HTML report. Defaults to "external" (the safer choice) if mode isn't specified or invalid.
router.get("/:id/report.html", async (req, res) => {
  try {
    const record = await getRun(req.params.id);
    if (!record) return res.status(404).json({ error: "Run not found" });
    const mode = req.query.mode === "internal" ? "internal" : "external";
    const html = buildRunReportHtml(record, mode);
    const safeName = (record.testName || "report").replace(/[^a-z0-9-_]/gi, "_");
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_${mode}_report.html"`);
    res.send(html);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate report" });
  }
});

// GET /api/runs/:id/calls?page=1&limit=200
// Returns per-request rows from the JTL file, paginated. Also reads the
// failures.xml listener file (written during the run) to attach the actual
// server response body to each failed row — same data JMeter's View Results
// Tree shows. Reads from disk on demand; raw rows are not stored in memory.
router.get("/:id/calls", async (req, res) => {
  try {
    const record = await getRun(req.params.id);
    if (!record) return res.status(404).json({ error: "Run not found" });

    const jtlPath = getRunFilePath(req.params.id, "jtl");
    if (!jtlPath || !fs.existsSync(jtlPath)) {
      return res.json({ calls: [], total: 0, page: 1, totalPages: 0 });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

    const csv = fs.readFileSync(jtlPath, "utf-8");
    const rows = parseJtlCsv(csv);
    const total = rows.length;
    const totalPages = Math.ceil(total / limit);
    const sliced = rows.slice((page - 1) * limit, page * limit);
    const minTs = rows.length ? Math.min(...rows.map((r) => r.timeStamp)) : 0;

    // Read failures.xml for actual server response bodies. Match by timestamp
    // since that's the most reliable key present in both files.
    const failuresPath = path.join(record.dir, "failures.xml");
    const bodyByTs = new Map<number, string>();
    if (fs.existsSync(failuresPath)) {
      try {
        const xml = fs.readFileSync(failuresPath, "utf-8");
        const { XMLParser } = require("fast-xml-parser");
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
        const doc = parser.parse(xml);
        const root = doc?.testResults;
        if (root) {
          const samples = ([] as any[]).concat(root.httpSample || [], root.sample || []);
          for (const s of samples) {
            if (!s || typeof s !== "object") continue;
            const ts = Number(s["@_ts"] ?? s["@_timeStamp"] ?? 0);
            let body: string | undefined;
            const rd = s.responseData;
            if (typeof rd === "string") body = rd;
            else if (rd && typeof rd["#text"] === "string") body = rd["#text"];
            if (body?.trim() && ts) bodyByTs.set(ts, body.trim());
          }
        }
      } catch { /* failures.xml parsing failure is non-fatal */ }
    }

    const calls = sliced.map((r, i) => ({
      index: (page - 1) * limit + i + 1,
      relativeMs: r.timeStamp - minTs,
      label: r.label,
      responseCode: r.responseCode,
      success: r.success,
      elapsed: r.elapsed,
      bytes: r.bytes,
      failureMessage: r.failureMessage || null,
      responseBody: bodyByTs.get(r.timeStamp) ?? null,
      threads: r.allThreads,
    }));

    res.json({ calls, total, page, totalPages, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to read call data" });
  }
});

// DELETE /api/runs/:id
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await deleteRun(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Run not found" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to delete run" });
  }
});

// PATCH /api/runs/:id/label  body: { label: string }
router.patch("/:id/label", async (req, res) => {
  try {
    const label = req.body?.label ?? "";
    const record = await labelRun(req.params.id, label);
    if (!record) return res.status(404).json({ error: "Run not found" });
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update label" });
  }
});

export default router;

// POST /api/runs/trigger — CI/CD endpoint
// Starts a run from a config object or saved config ID. Returns the run ID
// immediately so pipelines can poll GET /api/runs/:id for status.
// Example: curl -X POST http://localhost:4000/api/runs/trigger \
//   -H "Content-Type: application/json" \
//   -d '{"savedConfigId": "uuid", "waitForCompletion": false}'
router.post("/trigger", async (req, res) => {
  try {
    const { config, savedConfigId, waitForCompletion = false } = req.body;
    let runConfig = config;

    if (savedConfigId) {
      const { getSavedConfig } = require("../savedConfigs/savedConfigsStore");
      const saved = await getSavedConfig(savedConfigId);
      if (!saved) return res.status(404).json({ error: `Saved config "${savedConfigId}" not found.` });
      runConfig = saved.config;
    }

    if (!runConfig) {
      return res.status(400).json({ error: "Provide either 'config' (BuildConfig object) or 'savedConfigId' (UUID)." });
    }

    const run = await createRun(runConfig, undefined, "ci-cd");
    
    if (waitForCompletion) {
      // Poll until terminal state (max 10 minutes)
      const maxWait = 600000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 3000));
        const updated = await getRun(run.id);
        if (!updated || !["queued", "running"].includes(updated.status)) {
          return res.json({
            runId: run.id,
            status: updated?.status || "unknown",
            pollUrl: `/api/runs/${run.id}`,
            reportUrl: `/api/runs/${run.id}/report.html?mode=external`,
          });
        }
      }
      return res.status(408).json({ error: "Run did not complete within 10 minutes.", runId: run.id });
    }

    res.json({
      runId: run.id,
      status: run.status,
      pollUrl: `/api/runs/${run.id}`,
      reportUrl: `/api/runs/${run.id}/report.html?mode=external`,
      message: `Run started. Poll ${req.protocol}://${req.get("host")}/api/runs/${run.id} for status.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to trigger run." });
  }
});
