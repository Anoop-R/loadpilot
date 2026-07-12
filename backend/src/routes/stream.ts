/**
 * SSE (Server-Sent Events) streaming endpoint for live run metrics.
 * Tails the JTL file as JMeter writes it, parses new rows every second,
 * and pushes rolling metrics to the browser in real time.
 *
 * Usage: GET /api/runs/:id/stream
 * Client: new EventSource('/api/runs/:id/stream')
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { getRun } from "../runs/runManager";
import { parseJtlCsv, aggregateByLabel } from "../utils/jtlParser";

const router = Router();

const ACTIVE = new Set(["queued", "running"]);

router.get("/", async (req: any, res) => {
  const id: string = req.params.id || req.query.id;

  const run = await getRun(id);
  if (!run) return res.status(404).end();

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  const jtlPath = path.join(run.dir, "results.jtl");

  let position = 0;
  let headerLine = "";
  let allRows: string[] = [];
  let tickCount = 0;

  function send(event: string, data: object) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  async function tick() {
    tickCount++;
    const current = await getRun(id);
    if (!current) return;

    // Send status update every tick
    send("status", { status: current.status, logTail: current.logTail.slice(-5) });

    // Read new JTL content
    if (!fs.existsSync(jtlPath)) return;

    try {
      const stat = fs.statSync(jtlPath);
      if (stat.size <= position) return;

      const buf = Buffer.alloc(stat.size - position);
      const fd = fs.openSync(jtlPath, "r");
      fs.readSync(fd, buf, 0, buf.length, position);
      fs.closeSync(fd);
      position = stat.size;

      const newText = buf.toString("utf8");
      const lines = newText.split(/\r?\n/).filter(l => l.trim());

      for (const line of lines) {
        if (!headerLine) {
          // First line is the CSV header
          headerLine = line;
        } else {
          allRows.push(line);
        }
      }

      if (!headerLine || allRows.length === 0) return;

      // Parse and aggregate all rows seen so far
      const csv = headerLine + "\n" + allRows.join("\n");
      const rows = parseJtlCsv(csv);
      if (rows.length === 0) return;

      const stats = aggregateByLabel(rows);
      const elapsed = current.startedAt
        ? Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000)
        : 0;

      send("metrics", {
        stats,
        elapsed,
        totalSamples: rows.length,
        totalErrors: rows.filter(r => !r.success).length,
        tickCount,
      });

      // Push to monitoring platforms every 5 seconds
      if (tickCount % 5 === 0 && stats.length > 0) {
        pushMetricsToMonitoring(stats, id, elapsed).catch(() => {});
      }
    } catch { /* file still being written — retry next tick */ }
  }

  // Heartbeat every 15s — prevents proxies/firewalls from closing idle connections
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  const interval = setInterval(async () => {
    try {
      await tick();
      const current = await getRun(id);
      if (!current || !ACTIVE.has(current.status)) {
        // Run finished — send final state and close
        if (current) send("complete", { status: current.status });
        clearInterval(interval);
        res.end();
      }
    } catch { /* ignore tick errors */ }
  }, 1000);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    res.end();
  });
});

export default router;

// Metrics push helper — called every 5 ticks (5 seconds) during a live run
export async function pushMetricsToMonitoring(
  stats: any[],
  runId: string,
  elapsed: number
) {
  const { getSettings } = require("../db/settings");
  const settings = await getSettings();
  const s = settings as any;

  if (!s.datadogApiKey && !s.newrelicLicenseKey && !s.metricsWebhookUrl) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const label = stats[0]?.label || "all";

  // Datadog
  if (s.datadogApiKey && stats[0]) {
    const site = s.datadogSite || "datadoghq.com";
    const series = [
      { metric: "loadpilot.p95_ms",       points: [[timestamp, stats[0].p95Ms]],         tags: [`run:${runId}`, `label:${label}`] },
      { metric: "loadpilot.avg_ms",        points: [[timestamp, stats[0].avgMs]],          tags: [`run:${runId}`, `label:${label}`] },
      { metric: "loadpilot.error_pct",     points: [[timestamp, stats[0].errorPct]],       tags: [`run:${runId}`, `label:${label}`] },
      { metric: "loadpilot.throughput_rps", points: [[timestamp, stats[0].throughputPerSec]], tags: [`run:${runId}`, `label:${label}`] },
    ];
    fetch(`https://api.${site}/api/v1/series`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "DD-API-KEY": s.datadogApiKey },
      body: JSON.stringify({ series }),
    }).catch(() => {});
  }

  // New Relic
  if (s.newrelicLicenseKey && stats[0]) {
    const metrics = [{
      metrics: [
        { name: "loadpilot.p95_ms",        value: stats[0].p95Ms,           timestamp, "interval.ms": 5000, type: "gauge", attributes: { runId } },
        { name: "loadpilot.avg_ms",         value: stats[0].avgMs,            timestamp, "interval.ms": 5000, type: "gauge", attributes: { runId } },
        { name: "loadpilot.error_pct",      value: stats[0].errorPct,         timestamp, "interval.ms": 5000, type: "gauge", attributes: { runId } },
        { name: "loadpilot.throughput_rps", value: stats[0].throughputPerSec, timestamp, "interval.ms": 5000, type: "gauge", attributes: { runId } },
      ]
    }];
    fetch("https://metric-api.newrelic.com/metric/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Api-Key": s.newrelicLicenseKey },
      body: JSON.stringify(metrics),
    }).catch(() => {});
  }

  // Generic webhook
  if (s.metricsWebhookUrl) {
    fetch(s.metricsWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, elapsed, timestamp, stats }),
    }).catch(() => {});
  }
}
