// Parses a JMeter JTL file (CSV format) and computes per-label aggregate
// stats deterministically in code. The LLM is only ever shown these computed
// numbers — it never has to "do math" on raw rows, which avoids hallucinated
// statistics.

import { XMLParser } from "fast-xml-parser";

export interface JtlRow {
  timeStamp: number;
  elapsed: number;
  label: string;
  responseCode: string;
  success: boolean;
  failureMessage: string;
  bytes: number;
  allThreads: number;
}

export interface ErrorBreakdownEntry {
  responseCode: string;
  count: number;
  sampleMessage: string;
  /** A real excerpt of what the server actually sent back, when available (see parseFailureResponsesXml). */
  sampleResponseBody?: string;
}

export interface TimeSeriesPoint {
  /** Seconds elapsed since the first sample in this label, for the X axis. */
  t: number;
  avgMs: number;
  errorCount: number;
  sampleCount: number;
}

export interface PerformanceThresholds {
  /**
   * p95 response time thresholds — rated from fastest to slowest.
   * Each level is "at or below this value". Everything above degradedMs is "poor".
   *
   * Backward compat: old saved configs only have goodMs + moderateMs (from the
   * previous 3-level system). resolveThresholds() fills in the missing levels
   * from those two values so old configs keep working without any migration.
   */
  excellentMs?: number;  // e.g. 300ms  — blazing fast, great UX
  goodMs: number;        // e.g. 500ms  — fast, no complaints
  acceptableMs?: number; // e.g. 1000ms — usable, noticeable delay
  degradedMs?: number;   // e.g. 2000ms — slow, users frustrated (old "moderateMs")
  moderateMs?: number;   // kept for backward compat with old saved configs

  /**
   * Error rate thresholds (as a % of total samples, 0–100).
   * Independent of the response-time levels above — a fast-but-failing
   * endpoint gets a separate flag, not hidden inside the response-time rating.
   */
  acceptableErrorPct?: number; // e.g. 1  — below this is fine
  warningErrorPct?: number;    // e.g. 5  — above this warrants investigation; above acceptableErrorPct is warning; above warningErrorPct is critical
}

/** Fills in missing levels from a partial threshold config and normalises old 2-level configs. */
export function resolveThresholds(t: PerformanceThresholds): Required<Omit<PerformanceThresholds, "moderateMs">> {
  const degraded = t.degradedMs ?? t.moderateMs ?? 2000;
  const good = t.goodMs ?? 500;
  return {
    excellentMs:        t.excellentMs        ?? Math.round(good * 0.6),
    goodMs:             good,
    acceptableMs:       t.acceptableMs        ?? Math.round((good + degraded) / 2),
    degradedMs:         degraded,
    acceptableErrorPct: t.acceptableErrorPct  ?? 1,
    warningErrorPct:    t.warningErrorPct     ?? 5,
  };
}

export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  goodMs: 500, moderateMs: 2000,
};

export type PerformanceRating = "excellent" | "good" | "acceptable" | "degraded" | "poor";
export type ErrorRating = "ok" | "warning" | "critical";

export function ratePerformance(p95Ms: number, thresholds: PerformanceThresholds): PerformanceRating {
  const t = resolveThresholds(thresholds);
  if (p95Ms <= t.excellentMs)  return "excellent";
  if (p95Ms <= t.goodMs)       return "good";
  if (p95Ms <= t.acceptableMs) return "acceptable";
  if (p95Ms <= t.degradedMs)   return "degraded";
  return "poor";
}

export function rateErrorPct(errorPct: number, thresholds: PerformanceThresholds): ErrorRating {
  const t = resolveThresholds(thresholds);
  if (errorPct <= t.acceptableErrorPct) return "ok";
  if (errorPct <= t.warningErrorPct)    return "warning";
  return "critical";
}

export interface LabelStats {
  label: string;
  samples: number;
  errors: number;
  errorPct: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputPerSec: number;
  maxThreads: number;
  errorBreakdown: ErrorBreakdownEntry[];
  timeSeries: TimeSeriesPoint[];
  /** Rated from p95Ms against the given (or default) thresholds. */
  performanceRating: PerformanceRating;
  /** Rated from errorPct against the error-rate thresholds — independent of response-time rating. */
  errorRating: ErrorRating;
}

/**
 * Parses raw CSV text into rows of fields, RFC4180-style: a quoted field can
 * contain commas and even literal newlines (JMeter's failureMessage column
 * regularly does, e.g. multi-line assertion failure text), so splitting on
 * newlines before handling quotes — the naive approach — silently shreds
 * those rows. This parses the whole text in one pass instead, only treating
 * a comma/newline as a delimiter when not inside an open quote.
 */
function parseCsvRows(text: string): string[][] {
  // Strip a leading UTF-8 BOM if present (can show up in files written on Windows).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // swallow; the matching \n (if any) ends the row below
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // Last row if the file doesn't end with a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function parseJtlCsv(csv: string): JtlRow[] {
  const allRows = parseCsvRows(csv);
  if (allRows.length < 2) return [];

  const header = allRows[0];
  const idx = (name: string) => header.indexOf(name);

  const iTs = idx("timeStamp");
  const iElapsed = idx("elapsed");
  const iLabel = idx("label");
  const iCode = idx("responseCode");
  const iSuccess = idx("success");
  const iFailMsg = idx("failureMessage");
  const iBytes = idx("bytes");
  const iThreads = idx("allThreads");

  if (iElapsed === -1 || iLabel === -1) {
    throw new Error(
      "This doesn't look like a JMeter JTL CSV — missing 'elapsed' or 'label' columns. " +
        "Make sure the JTL was saved in CSV format with a header row (the default JMeter Listener output)."
    );
  }

  const rows: JtlRow[] = [];
  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
    if (cols.length < header.length) continue;
    rows.push({
      timeStamp: Number(cols[iTs]) || 0,
      elapsed: Number(cols[iElapsed]) || 0,
      label: cols[iLabel] || "unknown",
      responseCode: iCode >= 0 ? cols[iCode] || "" : "",
      success: iSuccess >= 0 ? (cols[iSuccess] || "").toLowerCase() === "true" : true,
      failureMessage: iFailMsg >= 0 ? cols[iFailMsg] || "" : "",
      bytes: iBytes >= 0 ? Number(cols[iBytes]) || 0 : 0,
      allThreads: iThreads >= 0 ? Number(cols[iThreads]) || 0 : 0,
    });
  }
  return rows;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function buildErrorBreakdown(rs: JtlRow[], bodySamples?: Map<string, string>): ErrorBreakdownEntry[] {
  const byCode = new Map<string, { count: number; sampleMessage: string }>();
  for (const r of rs) {
    if (r.success) continue;
    const code = r.responseCode || "(no response code)";
    const entry = byCode.get(code) || { count: 0, sampleMessage: "" };
    entry.count++;
    if (!entry.sampleMessage && r.failureMessage) {
      entry.sampleMessage = truncate(r.failureMessage, 240);
    }
    byCode.set(code, entry);
  }
  return Array.from(byCode.entries())
    .map(([responseCode, v]) => ({
      responseCode,
      count: v.count,
      sampleMessage: v.sampleMessage,
      sampleResponseBody: bodySamples?.get(`${rs[0]?.label}|${responseCode}`),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Parses the optional failures.xml produced by the failure-capture listener
 * (see jmxBuilder.ts) into {label, responseCode, body} triples. This is a
 * best-effort addition on top of the main stats pipeline: the exact XML
 * attribute names couldn't be verified against a real successful JMeter
 * execution, so this checks several plausible naming conventions and simply
 * returns nothing usable if none of them match — never throws, never blocks
 * the rest of the report from rendering normally.
 */
export function parseFailureResponsesXml(xml: string): { label: string; responseCode: string; body: string }[] {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
    const doc = parser.parse(xml);
    const root = doc?.testResults;
    if (!root) return [];

    const rawSamples = ([] as any[]).concat(root.httpSample || [], root.sample || []);
    const results: { label: string; responseCode: string; body: string }[] = [];

    for (const s of rawSamples) {
      if (!s || typeof s !== "object") continue;
      const label = s["@_lb"] ?? s["@_label"] ?? "unknown";
      const responseCode = String(s["@_rc"] ?? s["@_responseCode"] ?? "");

      let body: string | undefined;
      const rd = s.responseData;
      if (typeof rd === "string") body = rd;
      else if (rd && typeof rd["#text"] === "string") body = rd["#text"];
      else if (typeof s["@_responseData"] === "string") body = s["@_responseData"];

      if (body && body.trim()) {
        results.push({ label: String(label), responseCode, body: truncate(body, 500) });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Buckets samples into a fixed number of time windows across the test's
 * duration, so the frontend can chart how response time and errors trended
 * over the run — not just the final aggregate numbers.
 */
function buildTimeSeries(rs: JtlRow[], buckets = 24): TimeSeriesPoint[] {
  if (rs.length === 0) return [];
  const minTs = Math.min(...rs.map((r) => r.timeStamp));
  const maxTs = Math.max(...rs.map((r) => r.timeStamp + r.elapsed));
  const span = Math.max(maxTs - minTs, 1);
  const bucketMs = span / buckets;

  const bucketed = Array.from({ length: buckets }, () => ({ sum: 0, count: 0, errors: 0 }));
  for (const r of rs) {
    let idx = Math.floor((r.timeStamp - minTs) / bucketMs);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    bucketed[idx].sum += r.elapsed;
    bucketed[idx].count += 1;
    if (!r.success) bucketed[idx].errors += 1;
  }

  return bucketed
    .map((b, i) => ({
      t: Math.round((i * bucketMs) / 1000),
      avgMs: b.count ? Math.round(b.sum / b.count) : 0,
      errorCount: b.errors,
      sampleCount: b.count,
    }))
    .filter((p) => p.sampleCount > 0);
}

export function aggregateByLabel(
  rows: JtlRow[],
  failureResponses?: { label: string; responseCode: string; body: string }[],
  thresholds: PerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS
): LabelStats[] {
  const bodySamples = new Map<string, string>();
  if (failureResponses) {
    for (const f of failureResponses) {
      const key = `${f.label}|${f.responseCode}`;
      if (!bodySamples.has(key)) bodySamples.set(key, f.body);
    }
  }

  const byLabel = new Map<string, JtlRow[]>();
  for (const r of rows) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, []);
    byLabel.get(r.label)!.push(r);
  }

  const result: LabelStats[] = [];
  for (const [label, rs] of byLabel) {
    const elapsed = rs.map((r) => r.elapsed).sort((a, b) => a - b);
    const errors = rs.filter((r) => !r.success).length;
    const minTs = Math.min(...rs.map((r) => r.timeStamp));
    const maxTs = Math.max(...rs.map((r) => r.timeStamp + r.elapsed));
    const durationSec = Math.max((maxTs - minTs) / 1000, 0.001);
    const p95 = percentile(elapsed, 95);

    result.push({
      label,
      samples: rs.length,
      errors,
      errorPct: Number(((errors / rs.length) * 100).toFixed(2)),
      avgMs: Math.round(elapsed.reduce((a, b) => a + b, 0) / elapsed.length),
      minMs: elapsed[0],
      maxMs: elapsed[elapsed.length - 1],
      p90Ms: percentile(elapsed, 90),
      p95Ms: p95,
      p99Ms: percentile(elapsed, 99),
      throughputPerSec: Number((rs.length / durationSec).toFixed(2)),
      maxThreads: Math.max(...rs.map((r) => r.allThreads)),
      errorBreakdown: buildErrorBreakdown(rs, bodySamples),
      timeSeries: buildTimeSeries(rs),
      performanceRating: ratePerformance(p95, thresholds),
      errorRating: rateErrorPct(Number(((errors / rs.length) * 100).toFixed(2)), thresholds),
    });
  }

  return result.sort((a, b) => b.p95Ms - a.p95Ms);
}

export interface ProbeSample {
  label: string;
  responseCode: string;
  requestData?: string;
  responseBody?: string;
}

/**
 * Parses the probe.xml produced by a one-pass auto-correlation probe run
 * (see jmxBuilder.ts's buildProbeJmx/probeCaptureXml) into one entry per
 * step, each with the real request that was sent and the real response that
 * came back. Same defensive style as parseFailureResponsesXml: tries a few
 * plausible attribute names, never throws, returns an empty array rather
 * than blocking the rest of the flow if the schema doesn't match.
 */
export function parseProbeXml(xml: string): ProbeSample[] {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
    const doc = parser.parse(xml);
    const root = doc?.testResults;
    if (!root) return [];

    const rawSamples = ([] as any[]).concat(root.httpSample || [], root.sample || []);
    const results: ProbeSample[] = [];

    const extractText = (node: any): string | undefined => {
      if (typeof node === "string") return node;
      if (node && typeof node["#text"] === "string") return node["#text"];
      return undefined;
    };

    for (const s of rawSamples) {
      if (!s || typeof s !== "object") continue;
      const label = String(s["@_lb"] ?? s["@_label"] ?? "unknown");
      const responseCode = String(s["@_rc"] ?? s["@_responseCode"] ?? "");
      const requestData = extractText(s.samplerData) ?? (typeof s["@_samplerData"] === "string" ? s["@_samplerData"] : undefined);
      const responseBody = extractText(s.responseData) ?? (typeof s["@_responseData"] === "string" ? s["@_responseData"] : undefined);
      results.push({
        label,
        responseCode,
        requestData: requestData ? truncate(requestData, 800) : undefined,
        responseBody: responseBody ? truncate(responseBody, 800) : undefined,
      });
    }
    return results;
  } catch {
    return [];
  }
}

/** Formats parsed probe samples into the "recorded transactions" text the correlation prompt expects. */
export function formatProbeAsTransactions(samples: ProbeSample[]): string {
  return samples
    .map((s, i) => {
      let block = `[${i + 1}] ${s.label} (response code: ${s.responseCode || "unknown"})`;
      if (s.requestData) block += `\nRequest:\n${s.requestData}`;
      if (s.responseBody) block += `\nResponse:\n${s.responseBody}`;
      return block;
    })
    .join("\n\n");
}
