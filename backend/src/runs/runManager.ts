import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getRunsDb, dbFind, dbFindOne, dbUpsert, dbDelete } from "../db/nedb";

import { BuildConfig, buildJmx } from "../builders/jmxBuilder";
import { parseJtlCsv, aggregateByLabel, parseFailureResponsesXml, LabelStats } from "../utils/jtlParser";
import { lintJmx, JmxFacts } from "../utils/jmxParser";
import { buildResultsAnalysisPrompt } from "../prompts/resultsAnalysis";
import { buildScriptReviewPrompt } from "../prompts/scriptReview";
import { callGroq, safeParseJson } from "../llm/groqClient";
import { estimateCost } from "../utils/pricing";
import { detectJmeter, jmeterCommand, jmeterSpawnOptions } from "./jmeterDetect";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface RunRecord {
  id: string;
  testName: string;
  /** Optional custom label set by the user after the run, separate from testName. Shown in history in place of testName when set. */
  runLabel?: string;
  config: BuildConfig;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  dir: string;
  logTail: string[];
  error?: string;
  jtlStats?: LabelStats[];
  analysis?: { summary: string; bottlenecks: any[]; recommendations: string[] };
  reviewFacts?: JmxFacts;
  review?: { issues: any[]; summary: string };
  usage?: { promptTokens: number; completionTokens: number };
  cost?: number;
  model?: string;
  createdBy?: string;
}

const _runsBase = (process as any).pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, "..", "..");
const DATA_DIR = path.join(process.env.LOADPILOT_DATA_DIR || path.join(_runsBase, "data"), "runs");
const MAX_LOG_LINES = 300;
const MAX_CONCURRENT_RUNS = Number(process.env.MAX_CONCURRENT_RUNS || 1);

fs.mkdirSync(DATA_DIR, { recursive: true });

const runs = new Map<string, RunRecord>();
const processes = new Map<string, ChildProcess>();
const queue: string[] = [];
let activeCount = 0;

// --- NeDB persistence ---

async function persistRun(record: RunRecord): Promise<void> {
  try {
    await dbUpsert(getRunsDb(), { id: record.id }, record);
  } catch (err: any) {
    console.error(`Failed to persist run ${record.id} to NeDB: ${err.message}`);
  }
}

async function hydrateFromNedb() {
  try {
    const docs = await dbFind<RunRecord>(getRunsDb(), {}, { createdAt: -1 }, 200);
    if (docs.length > 0) {
      for (const doc of docs) {
        if (!runs.has(doc.id)) runs.set(doc.id, doc);
      }
      console.log(`Loaded ${docs.length} past run(s) from NeDB.`);
    }
  } catch (err: any) {
    console.error(`Failed to load run history from NeDB: ${err.message}`);
  }
}

const hydrationPromise = hydrateFromNedb();

function appendLog(record: RunRecord, line: string) {
  record.logTail.push(line);
  if (record.logTail.length > MAX_LOG_LINES) {
    record.logTail.splice(0, record.logTail.length - MAX_LOG_LINES);
  }
}

export async function listRuns(): Promise<RunRecord[]> {
  await hydrationPromise;
  return Array.from(runs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getRun(id: string): Promise<RunRecord | undefined> {
  await hydrationPromise;
  if (runs.has(id)) return runs.get(id);
  // Not in memory — check NeDB (handles post-restart lookups)
  const doc = await dbFindOne<RunRecord>(getRunsDb(), { id });
  if (!doc) return undefined;
  runs.set(id, doc);
  return doc;
}

export async function createRun(
  config: BuildConfig,
  csv?: { filename: string; buffer: Buffer },
  createdBy?: string
): Promise<RunRecord> {
  const id = randomUUID();
  const dir = path.join(DATA_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const fullConfig: BuildConfig = csv
    ? {
        ...config,
        csv: {
          ...config.csv,
          filename: csv.filename,
          variableNames: config.csv?.variableNames || [],
        },
      }
    : config;

  const jmx = buildJmx(fullConfig);
  fs.writeFileSync(path.join(dir, "plan.jmx"), jmx, "utf-8");

  if (csv) {
    fs.writeFileSync(path.join(dir, csv.filename), csv.buffer);
  }

  const record: RunRecord = {
    id,
    testName: config.testName,
    config: fullConfig,
    status: "queued",
    createdAt: new Date().toISOString(),
    dir,
    logTail: [],
    createdBy,
  };
  runs.set(id, record);
  await persistRun(record);
  queue.push(id);
  processQueue();
  return record;
}

/** Generates a .jmx for download only, without creating a tracked run. */
export function generateJmxOnly(config: BuildConfig): string {
  return buildJmx(config);
}

function processQueue() {
  if (activeCount >= MAX_CONCURRENT_RUNS) return;
  const id = queue.shift();
  if (!id) return;
  const record = runs.get(id);
  if (!record) return processQueue();

  activeCount++;
  runJmeter(record).finally(() => {
    activeCount--;
    processQueue();
  });
}

async function runJmeter(record: RunRecord) {
  const status = await detectJmeter();
  if (!status.available) {
    record.status = "failed";
    record.error = "JMeter is not available on this server. The .jmx was still generated — download it and run it wherever JMeter is installed.";
    record.finishedAt = new Date().toISOString();
    await persistRun(record);
    return;
  }

  record.status = "running";
  record.startedAt = new Date().toISOString();

  // Load settings before spawning (needs async context)
  const { getSettings } = require("../db/settings");
  const appSettings = await getSettings();
  const remoteAgents = appSettings.remoteAgents.filter((a: string) => a.trim());

  await new Promise<void>((resolve) => {
    let proc: ChildProcess;
    try {
      const jmeterArgs = ["-n", "-t", "plan.jmx", "-l", "results.jtl"];
      if (remoteAgents.length > 0) {
        jmeterArgs.push(`-Jremote_hosts=${remoteAgents.join(",")}`);
        jmeterArgs.push("-r");
        appendLog(record, `[Distributed] Using ${remoteAgents.length} remote agent(s): ${remoteAgents.join(", ")}`);
      }

      proc = spawn(jmeterCommand(), jmeterArgs, {
        cwd: record.dir,
        ...jmeterSpawnOptions(),
      });
    } catch (e: any) {
      record.status = "failed";
      record.error = `Failed to start JMeter: ${e.message}`;
      record.finishedAt = new Date().toISOString();
      persistRun(record);
      return resolve();
    }
    processes.set(record.id, proc);

    proc.stdout?.on("data", (d) => {
      String(d).split(/\r?\n/).filter(Boolean).forEach((l) => appendLog(record, l));
    });
    proc.stderr?.on("data", (d) => {
      String(d).split(/\r?\n/).filter(Boolean).forEach((l) => appendLog(record, l));
    });

    proc.on("error", (err) => {
      record.status = "failed";
      record.error = `Failed to start JMeter: ${err.message}`;
      record.finishedAt = new Date().toISOString();
      processes.delete(record.id);
      persistRun(record);
      resolve();
    });

    proc.on("close", async (code) => {
      processes.delete(record.id);
      if (record.status === "stopped") {
        record.finishedAt = new Date().toISOString();
        await persistRun(record);
        return resolve();
      }

      const jtlPath = path.join(record.dir, "results.jtl");
      const hasResults = fs.existsSync(jtlPath) && fs.statSync(jtlPath).size > 0;

      if (!hasResults) {
        record.status = "failed";
        record.error = `JMeter finished (exit code ${code}) but produced no results file. Check the log below for details.`;
        record.finishedAt = new Date().toISOString();
        await persistRun(record);
        return resolve();
      }

      try {
        await finalizeRun(record, jtlPath);
        record.status = "completed";
      } catch (e: any) {
        record.status = "failed";
        record.error = e.message || "Post-run analysis failed.";
      }
      record.finishedAt = new Date().toISOString();
      await persistRun(record);
      resolve();
    });
  });
}

async function finalizeRun(record: RunRecord, jtlPath: string) {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let model = "";

  // Results analysis (deterministic stats + LLM interpretation)
  const csv = fs.readFileSync(jtlPath, "utf-8");
  const rows = parseJtlCsv(csv);
  if (rows.length > 0) {
    let failureResponses: { label: string; responseCode: string; body: string }[] = [];
    const failuresXmlPath = path.join(record.dir, "failures.xml");
    if (fs.existsSync(failuresXmlPath)) {
      try {
        failureResponses = parseFailureResponsesXml(fs.readFileSync(failuresXmlPath, "utf-8"));
      } catch {
        failureResponses = []; // best-effort only — never let this block the rest of the report
      }
    }

    const stats = aggregateByLabel(rows, failureResponses, record.config.performanceThresholds);
    record.jtlStats = stats;
    const { system, user } = buildResultsAnalysisPrompt(stats, record.config.performanceThresholds);
    const result = await callGroq(system, user, { jsonMode: true, temperature: 0.2 });
    record.analysis = safeParseJson(result.content);
    totalPromptTokens += result.usage.promptTokens;
    totalCompletionTokens += result.usage.completionTokens;
    model = result.model;
  }

  // Script review (deterministic structure + LLM interpretation)
  const jmx = fs.readFileSync(path.join(record.dir, "plan.jmx"), "utf-8");
  const facts = lintJmx(jmx);
  record.reviewFacts = facts;
  const { system: rSystem, user: rUser } = buildScriptReviewPrompt(facts);
  const reviewResult = await callGroq(rSystem, rUser, { jsonMode: true, temperature: 0.2 });
  record.review = safeParseJson(reviewResult.content);
  totalPromptTokens += reviewResult.usage.promptTokens;
  totalCompletionTokens += reviewResult.usage.completionTokens;
  model = reviewResult.model;

  record.usage = { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
  record.cost = estimateCost(model, totalPromptTokens, totalCompletionTokens);
}

export function stopRun(id: string): boolean {
  const record = runs.get(id);
  const proc = processes.get(id);
  if (record && record.status === "queued") {
    const idx = queue.indexOf(id);
    if (idx >= 0) queue.splice(idx, 1);
    record.status = "stopped";
    record.finishedAt = new Date().toISOString();
    persistRun(record);
    return true;
  }
  if (record && proc && record.status === "running") {
    record.status = "stopped";
    if (process.platform === "win32" && proc.pid) {
      // shell:true means the direct child is cmd.exe wrapping jmeter.bat wrapping
      // java — a plain kill() would only stop cmd.exe and orphan the real process.
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    } else {
      proc.kill("SIGTERM");
    }
    return true;
  }
  return false;
}

export function getRunFilePath(id: string, type: "jmx" | "jtl"): string | null {
  const record = runs.get(id);
  if (!record) return null;
  const file = path.join(record.dir, type === "jmx" ? "plan.jmx" : "results.jtl");
  return fs.existsSync(file) ? file : null;
}

export async function deleteRun(id: string): Promise<boolean> {
  const record = runs.get(id);
  if (!record) return false;
  // Stop if running
  if (processes.has(id)) {
    const proc = processes.get(id)!;
    proc.kill("SIGTERM");
    processes.delete(id);
  }
  // Remove from memory
  runs.delete(id);
  await dbDelete(getRunsDb(), { id });
  // Remove files
  if (fs.existsSync(record.dir)) {
    fs.rmSync(record.dir, { recursive: true, force: true });
  }
  return true;
}

export async function labelRun(id: string, label: string): Promise<RunRecord | null> {
  const record = await getRun(id);
  if (!record) return null;
  record.runLabel = label.trim() || undefined;
  await persistRun(record);
  return record;
}

