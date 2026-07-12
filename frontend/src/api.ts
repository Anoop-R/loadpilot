import {
  AutoCorrelationResult,
  BuildConfig,
  CallsPage,
  CorrelationResponse,
  JmeterStatus,
  ParsedConfigResponse,
  ResultsAnalysisResponse,
  RunRecord,
  SavedConfig,
  ScriptReviewResponse,
  TestDataField,
  TestDataResponse,
} from "./types";
import { authHeaders, setAuth } from "./auth";

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export async function analyzeResults(
  file: File,
  thresholds?: { goodMs: number; moderateMs: number }
): Promise<ResultsAnalysisResponse> {
  const form = new FormData();
  form.append("jtl", file);
  if (thresholds) {
    form.append("goodMs", String(thresholds.goodMs));
    form.append("moderateMs", String(thresholds.moderateMs));
  }
  const res = await fetch("/api/results-analysis/analyze", { method: "POST", body: form });
  return handle<ResultsAnalysisResponse>(res);
}

export async function detectCorrelations(transactions: string): Promise<CorrelationResponse> {
  const res = await fetch("/api/correlation/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions }),
  });
  return handle<CorrelationResponse>(res);
}

export async function generateTestData(
  fields: TestDataField[],
  count: number,
  sample?: { requestBody?: string; responseBody?: string; notes?: string }
): Promise<TestDataResponse> {
  const res = await fetch("/api/test-data/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, count, sample }),
  });
  return handle<TestDataResponse>(res);
}

export async function converse(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<{ type: string; message: string; config?: any; ready?: boolean; usage: any; cost: number; model: string }> {
  const res = await fetch("/api/ai/converse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  return handle(res);
}

export async function reviewScript(file: File): Promise<ScriptReviewResponse> {
  const form = new FormData();
  form.append("jmx", file);
  const res = await fetch("/api/script-review/review", { method: "POST", body: form });
  return handle<ScriptReviewResponse>(res);
}

export async function getJmeterStatus(): Promise<JmeterStatus> {
  const res = await fetch("/api/builder/jmeter-status");
  return handle<JmeterStatus>(res);
}

/** Generates a .jmx and triggers a browser download, without creating a tracked run. */
export async function downloadGeneratedJmx(config: BuildConfig, csvFile?: File): Promise<File> {
  const form = new FormData();
  form.append("config", JSON.stringify(config));
  if (csvFile) form.append("csv", csvFile);
  const res = await fetch("/api/builder/generate", { method: "POST", body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to generate .jmx" }));
    throw new Error(data.error);
  }
  const blob = await res.blob();
  const filename = `${config.testName || "plan"}.jmx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  // Return as File so the Script Review tab can consume it directly
  return new File([blob], filename, { type: "application/xml" });
}

/** Runs a quick one-pass probe through the configured steps and suggests correlations found in the real traffic. */
export async function autoCorrelate(config: BuildConfig, csvFile?: File): Promise<AutoCorrelationResult> {
  const form = new FormData();
  form.append("config", JSON.stringify(config));
  if (csvFile) form.append("csv", csvFile);
  const res = await fetch("/api/builder/auto-correlate", { method: "POST", body: form });
  return handle<AutoCorrelationResult>(res);
}

/** Parses a plain-English test description into a structured suggestion — never applied automatically, the caller decides whether to use it. */
export async function parseDescription(description: string): Promise<ParsedConfigResponse> {
  const res = await fetch("/api/builder/parse-description", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return handle<ParsedConfigResponse>(res);
}

export async function createRun(config: BuildConfig, csvFile?: File): Promise<RunRecord> {
  const form = new FormData();
  form.append("config", JSON.stringify(config));
  if (csvFile) form.append("csv", csvFile);
  const res = await fetch("/api/runs", { method: "POST", body: form, headers: { ...authHeaders() } });
  return handle<RunRecord>(res);
}

export async function listRuns(): Promise<RunRecord[]> {
  const res = await fetch("/api/runs");
  return handle<RunRecord[]>(res);
}

export async function getRun(id: string): Promise<RunRecord> {
  const res = await fetch(`/api/runs/${id}`);
  return handle<RunRecord>(res);
}

export async function stopRun(id: string): Promise<void> {
  const res = await fetch(`/api/runs/${id}/stop`, { method: "POST" });
  await handle(res);
}

export async function deleteRun(id: string): Promise<void> {
  const res = await fetch(`/api/runs/${id}`, { method: "DELETE" });
  return handle<void>(res);
}

export async function labelRun(id: string, label: string): Promise<RunRecord> {
  const res = await fetch(`/api/runs/${id}/label`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  return handle<RunRecord>(res);
}

export function runDownloadUrl(id: string, type: "jmx" | "jtl"): string {
  return `/api/runs/${id}/download/${type}`;
}

export function runReportHtmlUrl(id: string, mode: "internal" | "external" = "external"): string {
  return `/api/runs/${id}/report.html?mode=${mode}`;
}

export async function getRunCalls(id: string, page = 1, limit = 200): Promise<CallsPage> {
  const res = await fetch(`/api/runs/${id}/calls?page=${page}&limit=${limit}`);
  return handle<CallsPage>(res);
}

export async function listSavedConfigs(): Promise<SavedConfig[]> {
  const res = await fetch("/api/saved-configs");
  return handle<SavedConfig[]>(res);
}

export async function createSavedConfig(name: string, config: BuildConfig): Promise<SavedConfig> {
  const res = await fetch("/api/saved-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, config }),
  });
  return handle<SavedConfig>(res);
}

export async function updateSavedConfig(id: string, name: string, config: BuildConfig): Promise<SavedConfig> {
  const res = await fetch(`/api/saved-configs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, config }),
  });
  return handle<SavedConfig>(res);
}

export async function deleteSavedConfig(id: string): Promise<void> {
  const res = await fetch(`/api/saved-configs/${id}`, { method: "DELETE" });
  await handle(res);
}

// --- Auth ---

export async function getAuthStatus(): Promise<{ available: boolean }> {
  const res = await fetch("/api/auth/status");
  return handle<{ available: boolean }>(res);
}

export async function login(username: string, password: string): Promise<{ username: string; isNewAccount?: boolean }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await handle<{ token: string; username: string; isNewAccount?: boolean }>(res);
  setAuth({ username: data.username, token: data.token });
  return data;
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: { ...authHeaders() } });
  } finally {
    setAuth(null);
  }
}

// ─── Probe (single request test) ────────────────────────────────────────
export interface ProbeResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  durationMs?: number;
  url?: string;
  error?: string;
}

export async function sendProbe(config: {
  protocol: string; domain: string; port?: number;
  path: string; method: string;
  headers: { name: string; value: string }[];
  body?: string;
}): Promise<ProbeResult> {
  const res = await fetch("/api/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return handle<ProbeResult>(res);
}

// ─── Schedules ───────────────────────────────────────────────────────────
export interface Schedule {
  id: string; name: string; config: any; cronExpr: string;
  enabled: boolean; createdAt: string; lastRunAt?: string;
  lastRunId?: string;
}

export async function listSchedules(): Promise<Schedule[]> {
  const res = await fetch("/api/schedules");
  return handle<Schedule[]>(res);
}

export async function createSchedule(data: { name: string; config: any; cronExpr: string }): Promise<Schedule> {
  const res = await fetch("/api/schedules", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  return handle<Schedule>(res);
}

export async function updateSchedule(id: string, patch: Partial<Schedule>): Promise<Schedule> {
  const res = await fetch(`/api/schedules/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  });
  return handle<Schedule>(res);
}

export async function deleteSchedule(id: string): Promise<void> {
  const res = await fetch(`/api/schedules/${id}`, { method: "DELETE" });
  return handle(res);
}

// ─── Settings ────────────────────────────────────────────────────────────
export interface AppSettings {
  remoteAgents: string[];
  defaultGoodMs: number;
  defaultAcceptableMs: number;
  timezone: string;
  maxConcurrentRuns: number;
}

export async function getAppSettings(): Promise<AppSettings> {
  const res = await fetch("/api/settings");
  return handle<AppSettings>(res);
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handle<AppSettings>(res);
}
