// Builds a single, self-contained HTML file from a completed run — no
// external CSS/JS/fonts, no network calls, nothing that breaks if opened
// offline or emailed to someone without this app installed. This is
// deliberately plain server-rendered HTML, not a snapshot of the React UI:
// the goal is a document that's readable on its own forever, not a copy of
// the live app's chrome (nav, buttons, "Stop" controls) that wouldn't make
// sense outside it.

import { RunRecord } from "../runs/runManager";
import { resolveSteps } from "../builders/jmxBuilder";
import { detectSensitiveHeaderNames, detectSensitiveBodyValues } from "./secretDetection";

export type ReportMode = "internal" | "external";

function esc(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Converts JMeter assertion diff format ([[[4]]]00) to plain English. */
function parseFriendlyAssertion(raw: string): string {
  const strip = (s: string) => s.replace(/\[\[\[/g, "").replace(/\]\]\]/g, "");
  const receivedMatch = raw.match(/\*+\s*received\s*:\s*(.+)/i);
  const comparisonMatch = raw.match(/\*+\s*comparison\s*:\s*(.+)/i);
  if (receivedMatch && comparisonMatch) {
    const received = strip(receivedMatch[1].trim());
    const expected = strip(comparisonMatch[1].trim());
    if (/^\d+$/.test(received) && /^\d+$/.test(expected)) {
      const code = Number(received);
      const hint =
        code === 400 ? " — server rejected the request (bad body or headers)" :
        code === 401 ? " — authentication failed" :
        code === 403 ? " — access denied" :
        code === 404 ? " — endpoint not found" :
        code === 429 ? " — rate limited (too many requests)" :
        code === 500 ? " — server error" :
        code === 502 ? " — bad gateway (server down or overloaded)" :
        code === 503 ? " — service unavailable" :
        code === 504 ? " — gateway timeout" : "";
      return `Status ${received}${hint} (expected ${expected})`;
    }
    return `Expected "${expected}" but got "${received}"`;
  }
  return raw.replace(/\[\[\[/g, "").replace(/\]\]\]/g, "").replace(/\n+/g, " ").replace(/\*+/g, "").trim();
}

function severityColor(sev: string): string {
  if (sev === "high") return "#e5564b";
  if (sev === "medium") return "#e8a33d";
  return "#4fb6a8";
}

const MASK = "••••••••";

/** Masks any occurrence of the given literal substrings within text. Used for secrets embedded directly in a request body. */
function redactLiterals(text: string, literals: string[] | undefined): string {
  if (!literals || literals.length === 0) return text;
  let result = text;
  for (const lit of literals) {
    if (!lit) continue;
    result = result.split(lit).join(MASK);
  }
  return result;
}

/** Returns a human-readable explanation of what each load setting actually did during this test. */
function explainLoadSettings(load: any, testType?: string): string {
  const rows: { label: string; value: string; meaning: string }[] = [];
  const t = testType || "load";
  const typeLabels: Record<string, string> = { load: "Load test", soak: "Soak test", spike: "Spike test", stepup: "Step-Up test", breakpoint: "Breakpoint test" };
  const typeMeanings: Record<string, string> = {
    load: "Steady pressure - the same number of users ran for the full duration.",
    soak: "Long-duration test - moderate users ran for an extended period to reveal gradual slowdowns and memory leaks.",
    spike: "Surge test - a base load ran continuously with a sudden burst of extra users for a short period.",
    stepup: "Staircase test - users were added in waves, showing exactly at which user count performance degrades.",
    breakpoint: "Limit-finding test - high user count run until failure appeared, identifying maximum capacity.",
  };
  rows.push({ label: "Test type", value: typeLabels[t] || t, meaning: typeMeanings[t] || "" });

  const users = Number(load.users) || 0;
  const userSuffix = users <= 5 ? "A light load, suitable for smoke testing." : users <= 20 ? "A moderate load, representative of normal team usage." : users <= 50 ? "A significant load - tests the API under a busy period." : "A heavy load - stress-testing the system limits.";
  rows.push({ label: "Concurrent users", value: String(users), meaning: users + " simulated users sent requests at the same time. " + userSuffix });

  const ramp = Number(load.rampUpSeconds) || 0;
  const rampMeaning = ramp === 0
    ? "All " + users + " users started at the exact same moment - the most aggressive scenario, simulating a sudden traffic surge with no warm-up."
    : "Users were added gradually over " + ramp + " seconds (roughly 1 new user every " + (ramp / Math.max(users, 1)).toFixed(1) + "s). This gives the server time to warm up and produces more realistic traffic patterns.";
  rows.push({ label: "Ramp-up", value: ramp + "s", meaning: rampMeaning });

  const loopCount = Number(load.loopCount) || 0;
  const duration = Number(load.durationSeconds) || 0;
  if (loopCount > 0) {
    const loopMeaning = loopCount === 1
      ? "Each user fired exactly one request then stopped. Total: " + users + " requests. Used for a single simultaneous burst rather than sustained load."
      : "Each user fired exactly " + loopCount + " requests then stopped. Total planned: " + (users * loopCount) + " requests.";
    rows.push({ label: "Loop count", value: loopCount + " per user", meaning: loopMeaning });
  } else {
    const durMins = (duration / 60).toFixed(1);
    const durSuffix = duration < 60 ? "Short smoke-check duration." : duration < 300 ? "Standard load test - long enough to see whether performance is stable under sustained pressure." : duration < 1800 ? "Medium-duration test - good for spotting gradual performance degradation." : "Long soak test - designed to catch memory leaks and slow degradation over time.";
    rows.push({ label: "Duration", value: duration + "s (" + durMins + " min)", meaning: durSuffix });
  }

  if (load.targetThroughputPerMinute) {
    rows.push({ label: "Throughput cap", value: load.targetThroughputPerMinute + " req/min", meaning: "A Constant Throughput Timer kept the overall rate at or below " + load.targetThroughputPerMinute + " req/min across all users. JMeter automatically adjusted wait times - so varying response times did not cause the rate to spike." });
  } else if (load.thinkTimeMs) {
    const think = Number(load.thinkTimeMs);
    const random = Number(load.thinkTimeRandomMs) || 0;
    const thinkVal = random ? think + "ms-" + (think + random) + "ms (random)" : think + "ms";
    const thinkMeaning = random ? "Each user paused " + think + "-" + (think + random) + "ms (randomly) between requests - simulating realistic reading time with natural variation." : "Each user waited " + think + "ms between requests - simulating the time a real user takes to read a response before acting.";
    rows.push({ label: "Think time", value: thinkVal, meaning: thinkMeaning });
  } else {
    rows.push({ label: "Think time", value: "None (full speed)", meaning: "No pause between requests - each user sent the next request the moment the previous one finished. Maximum throughput from the configured user count." });
  }

  if (load.syncTimer) {
    rows.push({ label: "Synchronizing timer", value: "Release when " + load.syncTimer.groupSize + " ready", meaning: "All " + load.syncTimer.groupSize + " users were held at a starting line and released simultaneously - every request fired at the exact same millisecond." });
  }

  const onErrorMap: Record<string, { value: string; meaning: string }> = {
    continue: { value: "Keep going", meaning: "Failures were recorded but did not stop the test - giving the most complete picture of error rates across the full run." },
    stopthread: { value: "Stop that user", meaning: "When a user request failed, that user session ended but others kept running." },
    stoptest: { value: "Stop whole test (graceful)", meaning: "The first failure caused the test to stop after in-flight requests finished." },
    stoptestnow: { value: "Stop whole test (immediate)", meaning: "The first failure caused the test to stop immediately, abandoning in-flight requests." },
  };
  const onErr = onErrorMap[load.onError || "continue"] || onErrorMap["continue"];
  rows.push({ label: "On failure", value: onErr.value, meaning: onErr.meaning });

  return rows.map(function(r) { return "\n    <div class=\"load-setting-row\">\n      <div class=\"load-setting-header\">\n        <span class=\"load-setting-label\">" + esc(r.label) + "</span>\n        <span class=\"load-setting-value\">" + esc(r.value) + "</span>\n      </div>\n      <p class=\"load-setting-meaning\">" + esc(r.meaning) + "</p>\n    </div>"; }).join("\n");
}

export function buildRunReportHtml(run: RunRecord, mode: ReportMode = "external"): string {
  const steps = resolveSteps(run.config);
  const generatedAt = new Date().toLocaleString();

  /**
   * "internal" mode: real values throughout, no masking at all — even
   * things manually marked sensitive show in full. For sharing within the
   * team that's actually running these tests.
   * "external" mode (default — the safer choice when in doubt): manually
   * marked sensitive items stay masked AND anything pattern-matching a
   * likely secret gets masked too, regardless of whether it was manually
   * flagged. For sharing outside the team.
   */
  const isExternal = mode === "external";

  const ratingColor = (r: string) => {
    if (r === "excellent") return "#3ecfbb";
    if (r === "good")      return "#4fb6a8";
    if (r === "acceptable") return "#e8a33d";
    if (r === "degraded")  return "#e8843d";
    if (r === "ok")        return "#4fb6a8";
    if (r === "warning")   return "#e8a33d";
    return "#e5564b"; // poor / critical
  };

  const statsTableRows = (run.jtlStats || [])
    .map(
      (s) => `<tr>
        <td>${esc(s.label)}</td>
        <td>${esc(s.samples)}</td>
        <td class="${s.errorPct > 0 ? "bad" : ""}">${esc(s.errorPct)}%</td>
        <td>${esc(s.minMs)}</td>
        <td>${esc(s.avgMs)}</td>
        <td>${esc(s.maxMs)}</td>
        <td>${esc(s.p90Ms)}</td>
        <td>${esc(s.p95Ms)}</td>
        <td>${esc(s.p99Ms)}</td>
        <td>${esc(s.throughputPerSec)}</td>
        <td>${esc(s.maxThreads)}</td>
        <td><span class="badge" style="background:${ratingColor(s.performanceRating)}22;color:${ratingColor(
        s.performanceRating
      )}">${esc(s.performanceRating)}</span></td>
        <td><span class="badge" style="background:${ratingColor(s.errorRating)}22;color:${ratingColor(s.errorRating)}">${esc(s.errorRating)}</span></td>
      </tr>`
    )
    .join("\n");

  const errorBreakdownHtml = (run.jtlStats || [])
    .filter((s) => s.errorBreakdown.length > 0)
    .map(
      (s) => `<div class="error-group">
        <strong>${esc(s.label)}</strong>
        <ul>
          ${s.errorBreakdown
            .map(
              (e) => {
                const friendlyMessage = e.sampleMessage ? parseFriendlyAssertion(e.sampleMessage) : null;
                return `<li>
                <span class="badge">${esc(e.responseCode)}</span>
                ${esc(e.count)} request${e.count === 1 ? "" : "s"}
                ${friendlyMessage ? `<div class="muted">${esc(friendlyMessage)}</div>` : ""}
                ${
                  e.sampleResponseBody
                    ? `<div class="response-body"><span class="label">What the server actually said:</span><code>${esc(
                        e.sampleResponseBody
                      )}</code></div>`
                    : ""
                }
              </li>`;
              }
            )
            .join("\n")}
        </ul>
      </div>`
    )
    .join("\n");

  const bottlenecksHtml = (run.analysis?.bottlenecks || [])
    .map(
      (b: any) => `<li style="border-left-color:${severityColor(b.severity)}">
        <span class="badge" style="background:${severityColor(b.severity)}22;color:${severityColor(
        b.severity
      )}">${esc(b.severity)}</span>
        <strong>${esc(b.label)}</strong>
        <p>${esc(b.observation)}</p>
        <p class="muted">Likely cause: ${esc(b.likelyCause)}</p>
      </li>`
    )
    .join("\n");

  const recommendationsHtml = (run.analysis?.recommendations || [])
    .map((r: string) => `<li>${esc(r)}</li>`)
    .join("\n");

  const reviewIssuesHtml = (run.review?.issues || [])
    .slice()
    .sort((a: any, b: any) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    })
    .map(
      (i: any) => `<li style="border-left-color:${severityColor(i.severity)}">
        <span class="badge" style="background:${severityColor(i.severity)}22;color:${severityColor(
        i.severity
      )}">${esc(i.severity)}</span>
        <strong>${esc(i.scope)}</strong>
        <p>${esc(i.issue)}</p>
        <p class="muted">Fix: ${esc(i.recommendation)}</p>
      </li>`
    )
    .join("\n");

  const stepsHtml = steps
    .map((step, i) => {
      const autoSensitiveHeaderNames = isExternal ? new Set(detectSensitiveHeaderNames(step.headers || [])) : new Set<string>();
      const autoSensitiveBodyValues = isExternal ? detectSensitiveBodyValues(step.body) : [];
      const effectiveSensitiveValues = [...(step.sensitiveValues || []), ...autoSensitiveBodyValues];

      const headerRows = (step.headers || [])
        .map((h) => {
          const masked = isExternal && (h.sensitive || autoSensitiveHeaderNames.has(h.name));
          return `<tr><td>${esc(h.name)}</td><td>${masked ? MASK : esc(isExternal ? redactLiterals(h.value, effectiveSensitiveValues) : h.value)}</td></tr>`;
        })
        .join("");
      const bodyText = step.body ? (isExternal ? redactLiterals(step.body, effectiveSensitiveValues) : step.body) : undefined;
      return `<div class="step">
        <strong>Step ${i + 1}${step.name ? `: ${esc(step.name)}` : ""}</strong>
        <p class="muted">${esc(step.method)} ${esc(step.path)}</p>
        ${
          headerRows
            ? `<table class="mini-table"><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>${headerRows}</tbody></table>`
            : ""
        }
        ${bodyText ? `<pre class="body-block">${esc(bodyText)}</pre>` : ""}
        ${
          step.assertions?.expectedStatusCode
            ? `<p class="muted">Expected status: ${esc(step.assertions.expectedStatusCode)}</p>`
            : ""
        }
      </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>LoadPilot Report — ${esc(run.testName)}</title>
<style>
  :root {
    --bg: #15171c; --panel: #1d2027; --border: #2a2e37; --text: #e7e6e2;
    --muted: #9a9ea7; --label: #c7cad1; --amber: #e8a33d; --teal: #4fb6a8; --red: #e5564b;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text); margin: 0 auto;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px; line-height: 1.6; max-width: 980px; padding: 40px 24px 80px;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
  h3 { font-size: 13px; margin: 14px 0 4px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 28px; }
  .meta span { margin-right: 16px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 20px 22px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); word-break: break-word; overflow-wrap: anywhere; }
  th { color: var(--label); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  td.bad { color: var(--red); font-weight: 600; }
  .mini-table { margin: 10px 0; }
  .mini-table td:first-child { width: 200px; color: var(--label); font-size: 12px; }
  .muted { color: var(--muted); margin: 4px 0; font-size: 13px; }
  .badge { font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: var(--border); color: var(--muted); margin-right: 6px; font-weight: 600; }
  ul.issue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  ul.issue-list li { border-left: 3px solid var(--border); padding-left: 14px; }
  ul.issue-list li p { margin: 3px 0; font-size: 13px; }
  .error-group { margin-bottom: 14px; }
  .error-group ul { list-style: none; padding: 0; }
  .error-group li { border-left: 3px solid var(--red); padding: 8px 0 8px 14px; margin-bottom: 8px; }
  .response-body { margin-top: 8px; padding: 10px 12px; background: rgba(229,86,75,0.06); border: 1px solid rgba(229,86,75,0.2); border-radius: 8px; }
  .response-body .label { display:block; font-size: 10px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; font-weight: 600; }
  .response-body code { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
  .step { border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px; }
  .step:first-child { border-top: none; padding-top: 0; margin-top: 0; }
  .body-block { background: #0d0f13; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; margin-top: 8px; overflow-x: auto; }
  .footer-note { color: var(--muted); font-size: 11px; margin-top: 32px; border-top: 1px solid var(--border); padding-top: 16px; }
  code, .body-block, .response-body code { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  /* Verdict card */
  .verdict-card { border-left: 3px solid var(--teal); }
  .verdict-text { font-size: 14px; line-height: 1.7; margin: 0 0 18px; }
  .key-metrics { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
  .key-metric { background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; min-width: 90px; text-align: center; }
  .key-metric-value { font-size: 18px; font-weight: 700; color: var(--text); font-family: ui-monospace, monospace; }
  .key-metric-value.metric-bad { color: var(--red); }
  .key-metric-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
  /* Load settings */
  .load-setting-row { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .load-setting-row:last-child { border-bottom: none; }
  .load-setting-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  .load-setting-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--label); min-width: 160px; }
  .load-setting-value { font-family: ui-monospace, monospace; font-size: 13px; font-weight: 600; color: var(--teal); }
  .load-setting-meaning { font-size: 12.5px; line-height: 1.6; color: var(--text); margin: 0; opacity: 0.85; }
  /* Print / PDF */
  @media print {
    :root { --bg: #fff; --panel: #f8f9fa; --border: #dee2e6; --text: #212529; --muted: #6c757d; --label: #495057; --amber: #d97706; --teal: #0d9488; --red: #dc2626; }
    body { padding: 20px; max-width: 100%; font-size: 12px; }
    .card { border: 1px solid #dee2e6; break-inside: avoid; margin-bottom: 12px; padding: 14px 16px; }
    h1 { font-size: 18px; } h2 { font-size: 13px; }
    table { font-size: 11px; } th, td { padding: 5px 7px; }
    .footer-note { border-top: 1px solid #dee2e6; padding-top: 10px; font-size: 10px; }
    .load-setting-meaning { font-size: 11px; }
    .badge { border: 1px solid currentColor; }
    @page { margin: 1.5cm; }
  }
</style>
</head>
<body>

<h1>${esc(run.runLabel || run.testName)}</h1>
<div class="meta">
  <span>Status: ${esc(run.status)}</span>
  <span>Run started: ${run.startedAt ? esc(new Date(run.startedAt).toLocaleString()) : "—"}</span>
  ${run.createdBy ? `<span>Started by: ${esc(run.createdBy)}</span>` : ""}
  <span>Report generated: ${esc(generatedAt)}</span>
  <button onclick="window.print()" style="margin-left:8px;padding:4px 14px;font-size:11px;cursor:pointer;background:var(--teal);color:#fff;border:none;border-radius:5px;font-family:inherit;font-weight:600">🖨 Print / Save PDF</button>
</div>

${run.error ? `<div class="card" style="border-color:var(--red)"><strong style="color:var(--red)">Error</strong><p>${esc(run.error)}</p></div>` : ""}

${
  run.analysis
    ? `<div class="card verdict-card">
  <h2>What happened</h2>
  <p class="verdict-text">${esc(run.analysis.summary)}</p>
  ${run.jtlStats && run.jtlStats.length > 0 ? (() => {
    const total = run.jtlStats.reduce((a, s) => a + s.samples, 0);
    const totalErrors = run.jtlStats.reduce((a, s) => a + s.errors, 0);
    const errPct = total > 0 ? ((totalErrors / total) * 100).toFixed(1) : "0";
    const avgMs = run.jtlStats.length === 1 ? run.jtlStats[0].avgMs : Math.round(run.jtlStats.reduce((a, s) => a + s.avgMs * s.samples, 0) / total);
    const p95 = run.jtlStats.length === 1 ? run.jtlStats[0].p95Ms : Math.max(...run.jtlStats.map(s => s.p95Ms));
    const rating = run.jtlStats[0]?.performanceRating || "—";
    const ratingColor = (r: string) => r === "excellent" ? "#3ecfbb" : r === "good" ? "#4fb6a8" : r === "acceptable" ? "#e8a33d" : r === "degraded" ? "#e8843d" : "#e5564b";
    return `<div class="key-metrics">
      <div class="key-metric"><div class="key-metric-value">${total}</div><div class="key-metric-label">Total requests</div></div>
      <div class="key-metric"><div class="key-metric-value ${Number(errPct) > 5 ? "metric-bad" : ""}">${errPct}%</div><div class="key-metric-label">Error rate</div></div>
      <div class="key-metric"><div class="key-metric-value">${avgMs}ms</div><div class="key-metric-label">Avg response</div></div>
      <div class="key-metric"><div class="key-metric-value">${p95}ms</div><div class="key-metric-label">p95 response</div></div>
      <div class="key-metric"><div class="key-metric-value" style="color:${ratingColor(rating)}">${rating}</div><div class="key-metric-label">Rating</div></div>
    </div>`;
  })() : ""}
</div>`
    : ""
}

${
  bottlenecksHtml
    ? `<div class="card"><h2>Bottlenecks</h2><ul class="issue-list">${bottlenecksHtml}</ul></div>`
    : ""
}

${
  recommendationsHtml
    ? `<div class="card"><h2>What to do next</h2><ul>${recommendationsHtml}</ul></div>`
    : ""
}

${errorBreakdownHtml ? `<div class="card"><h2>Error breakdown</h2>${errorBreakdownHtml}</div>` : ""}

${
  run.jtlStats
    ? `<div class="card">
  <h2>Full results</h2>
  <table>
    <thead><tr><th>Label</th><th>Samples</th><th>Err %</th><th>Min ms</th><th>Avg ms</th><th>Max ms</th><th>p90</th><th>p95</th><th>p99</th><th>Throughput/s</th><th>Max threads</th><th>Performance</th><th>Error rate</th></tr></thead>
    <tbody>${statsTableRows}</tbody>
  </table>
</div>`
    : ""
}



<div class="card">
  <h2>Test configuration</h2>
  <p class="muted" style="margin-bottom:16px">${esc(run.config.protocol)}://${esc(run.config.domain)}${
    run.config.port ? ":" + esc(run.config.port) : ""
  }</p>
  ${explainLoadSettings(run.config.load, (run.config as any).testType)}
  ${run.config.performanceThresholds ? `
  <div class="load-setting-row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
    <div class="load-setting-header">
      <span class="load-setting-label">Performance thresholds</span>
      <span class="load-setting-value">Good ≤ ${esc(run.config.performanceThresholds.goodMs)}ms p95</span>
    </div>
    <p class="load-setting-meaning">Response times were rated against a ${esc(run.config.performanceThresholds.goodMs)}ms target at the 95th percentile. This means 95% of requests needed to complete within ${esc(run.config.performanceThresholds.goodMs)}ms to be rated "good."</p>
  </div>` : ""}
  ${stepsHtml}
</div>

<p class="footer-note">Generated by LoadPilot. This is a static snapshot — re-export after future runs for updated numbers. ${
    isExternal
      ? "This is the EXTERNAL version — sensitive values appear masked (••••••••). For the full detail, use the internal report instead."
      : "This is the INTERNAL version — all values shown in full. Do not share outside your team."
  }</p>

</body>
</html>
`;
}
