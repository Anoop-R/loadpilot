import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import {
  autoCorrelate,
  createRun,
  createSavedConfig,
  deleteSavedConfig,
  downloadGeneratedJmx,
  getJmeterStatus,
  listSavedConfigs,
  updateSavedConfig,
} from "../api";
import { resolveSteps } from "../configUtils";
import { AutoCorrelationResult, BuildConfig, BuildStep, JmeterStatus, ParsedConfigSuggestion, RunRecord, SavedConfig } from "../types";
import FieldGuide from "./FieldGuide";
import AutoTextarea from "./AutoTextarea";
import SmartConfigBuilder from "./SmartConfigBuilder";
import ProbeRequest from "./ProbeRequest";
import { useToast } from "./Toast";
import { checkJwtExpiry } from "../utils/jwtExpiry";
import { detectSensitiveHeaderNames, detectSensitiveBodyValues } from "../secretDetection";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return idCounter;
}

interface HeaderRow {
  id: number;
  name: string;
  value: string;
  sensitive: boolean;
}

interface StepFormState {
  id: number;
  name: string;
  method: BuildStep["method"];
  path: string;
  headers: HeaderRow[];
  body: string;
  expectedStatusCode: string;
  maxResponseTimeMs: string;
  // Assertions — new
  jsonPath: string;
  jsonPathExpected: string;
  // Extract
  extractVariableName: string;
  extractType: "regex" | "jsonpath";
  extractRegex: string;
  extractJsonPath: string;
  extractDefaultValue: string;
  // Transaction grouping
  transactionName: string;
  // UI state
  headerPasteText: string;
  bulkEditMode: boolean;
  bulkEditText: string;
  sensitiveValues: string[];
  newSensitiveValueInput: string;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const DRAFT_STORAGE_KEY = "loadpilot_build_run_draft";
const CUSTOM_PRESETS_KEY = "loadpilot_custom_presets";

interface PresetConfig {
  label: string;
  users: number;
  rampUpSeconds: number;
  durationSeconds: number;
}

const BUILT_IN_PRESETS: PresetConfig[] = [
  { label: "Smoke test", users: 1, rampUpSeconds: 1, durationSeconds: 10 },
  { label: "Moderate load", users: 20, rampUpSeconds: 10, durationSeconds: 60 },
  { label: "Stress test", users: 100, rampUpSeconds: 20, durationSeconds: 120 },
];

const PRESETS = {
  smoke: { label: "Smoke test", users: 1, rampUpSeconds: 1, durationSeconds: 10 },
  moderate: { label: "Moderate load", users: 20, rampUpSeconds: 10, durationSeconds: 60 },
  stress: { label: "Stress test", users: 100, rampUpSeconds: 20, durationSeconds: 120 },
} as const;

function newStep(name = ""): StepFormState {
  return {
    id: nextId(),
    name,
    method: "GET",
    path: "/",
    headers: [{ id: nextId(), name: "Content-Type", value: "application/json", sensitive: false }],
    body: "",
    expectedStatusCode: "200",
    maxResponseTimeMs: "",
    jsonPath: "",
    jsonPathExpected: "",
    extractVariableName: "",
    extractType: "regex",
    extractRegex: "",
    extractJsonPath: "",
    extractDefaultValue: "",
    transactionName: "",
    headerPasteText: "",
    bulkEditMode: false,
    bulkEditText: "",
    sensitiveValues: [],
    newSensitiveValueInput: "",
  };
}

/**
 * Parses pasted header text into {name, value} pairs. Handles two real-world
 * formats: standard one-header-per-line text (e.g. copied from devtools or
 * Postman), and a single line with multiple "key:value" pairs separated by
 * whitespace (a format people commonly paste from internal API docs/notes).
 */
function parseHeadersText(text: string): { name: string; value: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 1) {
    return lines
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return null;
        return { name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
      })
      .filter((h): h is { name: string; value: string } => !!h && !!h.name);
  }

  // Single line — look for multiple "key:" boundaries (e.g. "a:1  b:2  c:3").
  const matches = [...trimmed.matchAll(/([A-Za-z0-9_-]+)\s*:\s*/g)];
  if (matches.length > 1) {
    const result: { name: string; value: string }[] = [];
    for (let i = 0; i < matches.length; i++) {
      const name = matches[i][1];
      const valueStart = matches[i].index! + matches[i][0].length;
      const valueEnd = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length;
      result.push({ name, value: trimmed.slice(valueStart, valueEnd).trim() });
    }
    return result;
  }

  const idx = trimmed.indexOf(":");
  if (idx === -1) return [];
  return [{ name: trimmed.slice(0, idx).trim(), value: trimmed.slice(idx + 1).trim() }];
}

export default forwardRef<
  { applyConfig: (config: any) => void },
  {
    onRunStarted: (run: RunRecord) => void;
    onJmxGenerated?: (file: File) => void;
    onCorrelationReady?: (prefill: string, source: "auto-detect" | "run-results") => void;
    onOpenReview?: () => void;
    onOpenCorrelation?: () => void;
    onTestDataVarsDetected?: (vars: string[]) => void;
  }
>(function BuildRunTab({ onRunStarted, onJmxGenerated, onCorrelationReady, onOpenReview, onOpenCorrelation, onTestDataVarsDetected }, ref) {
  const [jmeterStatus, setJmeterStatus] = useState<JmeterStatus | null>(null);

  const [testName, setTestName] = useState("My Load Test");
  const [protocol, setProtocol] = useState<"http" | "https" | "ws" | "wss">("https");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");

  const [steps, setSteps] = useState<StepFormState[]>([newStep()]);

  const [users, setUsers] = useState(20);
  const [rampUpSeconds, setRampUpSeconds] = useState(10);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [thinkTimeMs, setThinkTimeMs] = useState<string>("");
  const [thinkTimeRandomMs, setThinkTimeRandomMs] = useState<string>("");
  const [targetThroughputPerMinute, setTargetThroughputPerMinute] = useState<string>("");
  const [loopCount, setLoopCount] = useState<string>("");
  const [testType, setTestType] = useState<string>("load");
  const [spikeBaseUsers, setSpikeBaseUsers] = useState<string>("5");
  const [spikeUsers, setSpikeUsers] = useState<string>("40");
  const [spikeStartSeconds, setSpikeStartSeconds] = useState<string>("30");
  const [spikeDurationSeconds, setSpikeDurationSeconds] = useState<string>("60");
  const [stepCount, setStepCount] = useState<string>("4");
  const [stepUsers, setStepUsers] = useState<string>("10");
  const [stepDurationSeconds, setStepDurationSeconds] = useState<string>("60");
  const [stepRamp, setStepRamp] = useState<string>("5");
  const [syncTimerEnabled, setSyncTimerEnabled] = useState(false);
  const [customPresets, setCustomPresets] = useState<PresetConfig[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [syncTimerGroupSize, setSyncTimerGroupSize] = useState<string>("");
  const [syncTimerTimeout, setSyncTimerTimeout] = useState<string>("0");
  const [cookieManager, setCookieManager] = useState(false);
  const [excellentMs, setExcellentMs] = useState<string>("");
  const [goodMs, setGoodMs] = useState<string>("");
  const [acceptableMs, setAcceptableMs] = useState<string>("");
  const [degradedMs, setDegradedMs] = useState<string>("");
  const [acceptableErrorPct, setAcceptableErrorPct] = useState<string>("");
  const [warningErrorPct, setWarningErrorPct] = useState<string>("");
  const [onError, setOnError] = useState<"continue" | "stopthread" | "stoptest" | "stoptestnow">("continue");
  const [secretWarning, setSecretWarning] = useState<{
    action: "generate" | "run";
    perStep: { stepId: number; headerNames: string[]; bodyValues: string[] }[];
  } | null>(null);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvVariables, setCsvVariables] = useState<string[]>([]);
  const [stickyPerUser, setStickyPerUser] = useState(false);

  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");
  const [saveName, setSaveName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const [busy, setBusy] = useState<"generate" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [notice, setNotice] = useState<string | null>(null);
  const [correlateBusy, setCorrelateBusy] = useState(false);

  const draftRestoredRef = useRef(false);

  useEffect(() => {
    // Restore the last unsaved draft, if any, BEFORE anything else in this
    // effect or the persistence effect below — this read is synchronous, so
    // by the time the persistence effect (declared after this one) runs in
    // the same mount flush, draftRestoredRef is already true and it won't
    // overwrite a real draft with the form's blank initial state.
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as BuildConfig;
        applyConfig(draft);
      }
    } catch {
      // Corrupt or unreadable draft — ignore and start fresh, not fatal.
    } finally {
      draftRestoredRef.current = true;
    }

    getJmeterStatus()
      .then(setJmeterStatus)
      .catch(() => setJmeterStatus({ available: false, error: "Could not check JMeter status." }));
    refreshSavedConfigs();
  }, []);

  // Auto-saves the current form as a draft, debounced, so navigating to
  // another tab and back (which fully remounts this component) or closing
  // and reopening the browser doesn't lose an in-progress, not-yet-saved
  // config. Persists until you change the form again (this draft) or save
  // it as a named Saved Config — it's separate from that feature, a safety
  // net underneath it.
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(buildConfig()));
      } catch {
        // Storage full or unavailable — not fatal, the form still works for this session.
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [
    testName,
    protocol,
    domain,
    port,
    steps,
    users,
    rampUpSeconds,
    durationSeconds,
    thinkTimeMs,
    thinkTimeRandomMs,
    targetThroughputPerMinute,
    loopCount,
    testType,
    spikeBaseUsers,
    spikeUsers,
    spikeStartSeconds,
    spikeDurationSeconds,
    stepCount,
    stepUsers,
    stepDurationSeconds,
    stepRamp,
    syncTimerEnabled,
    syncTimerGroupSize,
    syncTimerTimeout,
    cookieManager,
    onError,
    stickyPerUser,
    excellentMs,
    goodMs,
    acceptableMs,
    degradedMs,
    acceptableErrorPct,
    warningErrorPct,
  ]);

  function refreshSavedConfigs() {
    listSavedConfigs()
      .then(setSavedConfigs)
      .catch(() => {});
  }

  function updateStep(id: number, patch: Partial<StepFormState>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, newStep(`Step ${prev.length + 1}`)]);
  }

  function removeStep(id: number) {
    setSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  }

  function updateStepHeader(stepId: number, headerId: number, patch: Partial<HeaderRow>) {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, headers: s.headers.map((h) => (h.id === headerId ? { ...h, ...patch } : h)) }
          : s
      )
    );
  }

  function addStepHeader(stepId: number) {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, headers: [...s.headers, { id: nextId(), name: "", value: "", sensitive: false }] }
          : s
      )
    );
  }

  function removeStepHeader(stepId: number, headerId: number) {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, headers: s.headers.filter((h) => h.id !== headerId) } : s))
    );
  }

  function handleParseHeaders(stepId: number) {
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;
    const parsed = parseHeadersText(step.headerPasteText);
    if (parsed.length === 0) {
      setError('Could not parse any headers from that text. Use "Name: Value" per line.');
      return;
    }
    setError(null);
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        const headers = [...s.headers];
        for (const p of parsed) {
          const existing = headers.find((h) => h.name.toLowerCase() === p.name.toLowerCase());
          if (existing) {
            existing.value = p.value;
          } else {
            headers.push({ id: nextId(), name: p.name, value: p.value, sensitive: false });
          }
        }
        return { ...s, headers: headers.filter((h) => h.name.trim()), headerPasteText: "" };
      })
    );
    setNotice(`Parsed and added ${parsed.length} header${parsed.length === 1 ? "" : "s"}.`);
  }

  /** Formats a step's current headers as "Name: Value" lines, one per row — the bulk-edit textarea's starting content. */
  function headersToText(headers: HeaderRow[]): string {
    return headers
      .filter((h) => h.name.trim())
      .map((h) => `${h.name}: ${h.value}`)
      .join("\n");
  }

  function enterBulkEdit(stepId: number) {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, bulkEditMode: true, bulkEditText: headersToText(s.headers) } : s))
    );
  }

  function cancelBulkEdit(stepId: number) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, bulkEditMode: false } : s)));
  }

  /**
   * Replaces a step's entire header list with whatever's in the bulk-edit
   * textarea — unlike "Parse & add" (which merges into existing rows), this
   * is a true Postman-style bulk edit: delete a line to remove that header,
   * edit a line to change it, add a line to add one. Sensitive flags are
   * preserved for headers whose name unchanged from before the edit.
   */
  function applyBulkEdit(stepId: number) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        const parsed = parseHeadersText(s.bulkEditText);
        const headers: HeaderRow[] = parsed.map((p) => {
          const prior = s.headers.find((h) => h.name.toLowerCase() === p.name.toLowerCase());
          return { id: prior?.id ?? nextId(), name: p.name, value: p.value, sensitive: prior?.sensitive ?? false };
        });
        return { ...s, headers, bulkEditMode: false };
      })
    );
    setNotice("Headers updated from bulk edit.");
  }

  function addSensitiveValue(stepId: number) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        const value = s.newSensitiveValueInput.trim();
        if (!value || s.sensitiveValues.includes(value)) return { ...s, newSensitiveValueInput: "" };
        return { ...s, sensitiveValues: [...s.sensitiveValues, value], newSensitiveValueInput: "" };
      })
    );
  }

  function removeSensitiveValue(stepId: number, value: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, sensitiveValues: s.sensitiveValues.filter((v) => v !== value) } : s))
    );
  }

  function insertVarIntoPath(stepId: number, varName: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, path: `${s.path}\${${varName}}` } : s))
    );
  }

  function insertVarIntoBody(stepId: number, varName: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, body: `${s.body}\${${varName}}` } : s))
    );
  }

  async function handleCsvSelected(file: File | null) {
    setCsvFile(file);
    if (!file) {
      setCsvVariables([]);
      return;
    }
    const text = await file.text();
    const header = text.split(/\r?\n/)[0] || "";
    setCsvVariables(header.split(",").map((h) => h.trim()).filter(Boolean));
  }

  function applyPreset(key: keyof typeof PRESETS) {
    const p = PRESETS[key];
    setUsers(p.users);
    setRampUpSeconds(p.rampUpSeconds);
    setDurationSeconds(p.durationSeconds);
  }

  function applyPresetConfig(p: PresetConfig) {
    setUsers(p.users);
    setRampUpSeconds(p.rampUpSeconds);
    setDurationSeconds(p.durationSeconds);
  }

  function saveCustomPreset() {
    const name = newPresetName.trim();
    if (!name) return;
    const preset: PresetConfig = {
      label: name,
      users: Math.max(1, Number(users) || 1),
      rampUpSeconds: Math.max(0, Number(rampUpSeconds) || 0),
      durationSeconds: Math.max(1, Number(durationSeconds) || 1),
    };
    const updated = [...customPresets, preset];
    setCustomPresets(updated);
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
    setNewPresetName("");
    setShowSavePreset(false);
    setNotice(`Preset "${name}" saved.`);
  }

  function deleteCustomPreset(index: number) {
    const updated = customPresets.filter((_, i) => i !== index);
    setCustomPresets(updated);
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
  }

  function buildConfig(stepsOverride?: StepFormState[]): BuildConfig {
    const effectiveSteps = stepsOverride ?? steps;
    return {
      testName: testName.trim() || "Load Test",
      protocol,
      domain: domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
      port: port ? Number(port) : undefined,
      testType: testType as any,
      spikeConfig: testType === "spike" ? {
        baseUsers: Number(spikeBaseUsers) || 5,
        spikeUsers: Number(spikeUsers) || 40,
        spikeStartSeconds: Number(spikeStartSeconds) || 30,
        spikeDurationSeconds: Number(spikeDurationSeconds) || 60,
      } : undefined,
      stepUpConfig: testType === "stepup" ? {
        stepsCount: Number(stepCount) || 4,
        usersPerStep: Number(stepUsers) || 10,
        stepDurationSeconds: Number(stepDurationSeconds) || 60,
        rampPerStep: Number(stepRamp) || 5,
      } : undefined,
      steps: effectiveSteps.map((s) => ({
        name: s.name.trim() || undefined,
        method: s.method,
        path: s.path.trim() || "/",
        headers: s.headers
          .filter((h) => h.name.trim())
          .map(({ name, value, sensitive }) => ({ name, value, sensitive: sensitive || undefined })),
        body: BODY_METHODS.has(s.method) && s.body.trim() ? s.body : undefined,
        assertions: {
          expectedStatusCode: s.expectedStatusCode.trim() || undefined,
          maxResponseTimeMs: s.maxResponseTimeMs ? Number(s.maxResponseTimeMs) : undefined,
          jsonPath: s.jsonPath.trim() || undefined,
          jsonPathExpected: s.jsonPath.trim() ? s.jsonPathExpected.trim() || undefined : undefined,
        },
        extract:
          s.extractVariableName.trim()
            ? s.extractType === "jsonpath" && s.extractJsonPath.trim()
              ? { type: "jsonpath" as const, variableName: s.extractVariableName.trim(), jsonPath: s.extractJsonPath.trim(), defaultValue: s.extractDefaultValue.trim() || undefined }
              : s.extractRegex.trim()
              ? { type: "regex" as const, variableName: s.extractVariableName.trim(), regex: s.extractRegex.trim(), defaultValue: s.extractDefaultValue.trim() || undefined }
              : undefined
            : undefined,
        sensitiveValues: s.sensitiveValues.length > 0 ? s.sensitiveValues : undefined,
        transactionName: s.transactionName.trim() || undefined,
      })),
      load: {
        users: Math.max(1, Number(users) || 1),
        rampUpSeconds: Math.max(0, Number(rampUpSeconds) || 0),
        durationSeconds: Math.max(1, Number(durationSeconds) || 1),
        thinkTimeMs: thinkTimeMs ? Number(thinkTimeMs) : undefined,
        thinkTimeRandomMs: thinkTimeRandomMs ? Number(thinkTimeRandomMs) : undefined,
        targetThroughputPerMinute: targetThroughputPerMinute ? Number(targetThroughputPerMinute) : undefined,
        loopCount: loopCount ? Number(loopCount) : undefined,
        syncTimer: syncTimerEnabled ? { groupSize: Number(syncTimerGroupSize) || Number(users), timeoutInMs: Number(syncTimerTimeout) || 0 } : undefined,
        onError: onError !== "continue" ? onError : undefined,
      },
      csv: csvFile ? { filename: csvFile.name, variableNames: csvVariables, stickyPerUser } : undefined,
      cookieManager: cookieManager || undefined,
      performanceThresholds:
        goodMs
          ? {
              excellentMs: excellentMs ? Number(excellentMs) : undefined,
              goodMs: Number(goodMs),
              acceptableMs: acceptableMs ? Number(acceptableMs) : undefined,
              degradedMs: degradedMs ? Number(degradedMs) : undefined,
              acceptableErrorPct: acceptableErrorPct ? Number(acceptableErrorPct) : undefined,
              warningErrorPct: warningErrorPct ? Number(warningErrorPct) : undefined,
            }
          : undefined,
    };
  }

  function validate(): string | null {
    if (!domain.trim()) return "Target host is required (e.g. api.example.com).";
    if (steps.some((s) => !s.path.trim())) return "Every step needs a path (e.g. /api/orders).";
    return null;
  }

  /** Populates the form from a previously saved config — handles both multi-step and legacy flat shapes. */
  function applyConfig(config: BuildConfig) {
    setTestName(config.testName);
    setProtocol(config.protocol);    setDomain(config.domain);
    setPort(config.port ? String(config.port) : "");

    const resolved = resolveSteps(config);
    setSteps(
      resolved.map((step) => ({
        id: nextId(),
        name: step.name || "",
        method: step.method,
        path: step.path,
        headers: step.headers.length
          ? step.headers.map((h) => ({ id: nextId(), name: h.name, value: h.value, sensitive: Boolean(h.sensitive) }))
          : [{ id: nextId(), name: "", value: "", sensitive: false }],
        body: step.body || "",
        expectedStatusCode: step.assertions?.expectedStatusCode || "",
        maxResponseTimeMs: step.assertions?.maxResponseTimeMs ? String(step.assertions.maxResponseTimeMs) : "",
        jsonPath: step.assertions?.jsonPath || "",
        jsonPathExpected: step.assertions?.jsonPathExpected || "",
        extractVariableName: step.extract?.variableName || "",
        extractType: (step.extract?.type || "regex") as "regex" | "jsonpath",
        extractRegex: step.extract?.regex || "",
        extractJsonPath: step.extract?.jsonPath || "",
        extractDefaultValue: step.extract?.defaultValue || "",
        transactionName: step.transactionName || "",
        headerPasteText: "",
        bulkEditMode: false,
        bulkEditText: "",
        sensitiveValues: step.sensitiveValues || [],
        newSensitiveValueInput: "",
      }))
    );

    setUsers(config.load.users);
    setRampUpSeconds(config.load.rampUpSeconds);
    setDurationSeconds(config.load.durationSeconds);
    setThinkTimeMs(config.load.thinkTimeMs ? String(config.load.thinkTimeMs) : "");
    setThinkTimeRandomMs(config.load.thinkTimeRandomMs ? String(config.load.thinkTimeRandomMs) : "");
    setTargetThroughputPerMinute(config.load.targetThroughputPerMinute ? String(config.load.targetThroughputPerMinute) : "");
    setLoopCount(config.load.loopCount ? String(config.load.loopCount) : "");
    setSyncTimerEnabled(Boolean(config.load.syncTimer));
    setSyncTimerGroupSize(config.load.syncTimer ? String(config.load.syncTimer.groupSize) : "");
    setSyncTimerTimeout(config.load.syncTimer ? String(config.load.syncTimer.timeoutInMs ?? 0) : "0");
    setOnError(config.load.onError || "continue");

    // Restore test type and spike/stepup config
    setTestType((config as any).testType || "load");
    if ((config as any).spikeConfig) {
      const sc = (config as any).spikeConfig;
      setSpikeBaseUsers(String(sc.baseUsers ?? 5));
      setSpikeUsers(String(sc.spikeUsers ?? 40));
      setSpikeStartSeconds(String(sc.spikeStartSeconds ?? 30));
      setSpikeDurationSeconds(String(sc.spikeDurationSeconds ?? 60));
    }
    if ((config as any).stepUpConfig) {
      const su = (config as any).stepUpConfig;
      setStepCount(String(su.stepsCount ?? 4));
      setStepUsers(String(su.usersPerStep ?? 10));
      setStepDurationSeconds(String(su.stepDurationSeconds ?? 60));
      setStepRamp(String(su.rampPerStep ?? 5));
    }

    setCsvFile(null);
    // Restore column names from saved config so ${variable} chips still appear.
    // The actual file can't be restored (browser security), but the names are enough
    // to show the chips and pass them to the JMX builder via the config.
    setCsvVariables(config.csv?.variableNames?.length ? config.csv.variableNames : []);
    setStickyPerUser(Boolean(config.csv?.stickyPerUser));
    setCookieManager(Boolean(config.cookieManager));
    const t = config.performanceThresholds;
    setExcellentMs(t?.excellentMs ? String(t.excellentMs) : "");
    setGoodMs(t?.goodMs ? String(t.goodMs) : "");
    setAcceptableMs(t?.acceptableMs ? String(t.acceptableMs) : "");
    setDegradedMs(t?.degradedMs ? String(t.degradedMs ?? t?.moderateMs ?? "") : t?.moderateMs ? String(t.moderateMs) : "");
    setAcceptableErrorPct(t?.acceptableErrorPct ? String(t.acceptableErrorPct) : "");
    setWarningErrorPct(t?.warningErrorPct ? String(t.warningErrorPct) : "");
    toast.success("✓ Config loaded — review settings below and run when ready.");

    // Extract ${variable} patterns from config and notify Test Data Generator
    if (onTestDataVarsDetected) {
      const allText = JSON.stringify(config);
      const vars = [...new Set([...allText.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]))];
      if (vars.length > 0) onTestDataVarsDetected(vars);
    }
  }

  // Expose applyConfig via ref so App.tsx can trigger it when user clicks
  // "Re-run" in Run Report, without needing complex global state or prop drilling.
  useImperativeHandle(ref, () => ({ applyConfig }));

  /**
   * Merges a chat-parsed suggestion into the current form — unlike applyConfig
   * (which replaces everything when loading a saved config), this only
   * overwrites fields the suggestion actually provided, leaving everything
   * else in the form untouched. Step-level fields (method/path/headers/body/
   * assertions) apply to the first step only — the chat feature is scoped to
   * single-step descriptions in this version, not multi-step flows.
   */
  function applyParsedSuggestion(config: ParsedConfigSuggestion) {
    if (config.testName) setTestName(config.testName);
    if (config.protocol) setProtocol(config.protocol);
    if (config.domain) setDomain(config.domain);
    if (config.port != null) setPort(String(config.port));
    if (config.users != null) setUsers(config.users);
    if (config.rampUpSeconds != null) setRampUpSeconds(config.rampUpSeconds);
    if (config.durationSeconds != null) setDurationSeconds(config.durationSeconds);
    if (config.thinkTimeMs != null) setThinkTimeMs(String(config.thinkTimeMs));
    if (config.onError) setOnError(config.onError);

    const hasStepFields =
      config.method || config.path || (config.headers && config.headers.length > 0) || config.body ||
      config.expectedStatusCode || config.maxResponseTimeMs != null;

    if (hasStepFields) {
      setSteps((prev) => {
        const first = prev[0];
        const updatedFirst: StepFormState = {
          ...first,
          method: config.method || first.method,
          path: config.path || first.path,
          headers:
            config.headers && config.headers.length > 0
              ? config.headers.map((h) => ({ id: nextId(), name: h.name, value: h.value, sensitive: false }))
              : first.headers,
          body: config.body || first.body,
          expectedStatusCode: config.expectedStatusCode || first.expectedStatusCode,
          maxResponseTimeMs:
            config.maxResponseTimeMs != null ? String(config.maxResponseTimeMs) : first.maxResponseTimeMs,
        };
        return [updatedFirst, ...prev.slice(1)];
      });
    }

    setNotice("Applied to the form below — review before running.");
  }

  function handleLoadSelected(id: string) {
    setSelectedSavedId(id);
    if (!id) return;
    const found = savedConfigs.find((c) => c.id === id);
    if (found) {
      applyConfig(found.config);
      setError(null);
      setNotice(`Loaded "${found.name}". Re-upload its test-data CSV below if it used one.`);
    }
  }

  async function handleSaveAsNew() {
    const name = saveName.trim() || testName.trim() || "Untitled config";
    setSaveBusy(true);
    setError(null);
    try {
      const record = await createSavedConfig(name, buildConfig());
      setSavedConfigs((prev) => [...prev, record].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSavedId(record.id);
      setSaveName("");
      setNotice(`Saved as "${name}".`);
    } catch (e: any) {
      setError(e.message || "Failed to save config.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleUpdateSelected() {
    const existing = savedConfigs.find((c) => c.id === selectedSavedId);
    if (!existing) return;
    setSaveBusy(true);
    setError(null);
    try {
      const record = await updateSavedConfig(existing.id, existing.name, buildConfig());
      setSavedConfigs((prev) => prev.map((c) => (c.id === record.id ? record : c)));
      setNotice(`Updated "${record.name}".`);
    } catch (e: any) {
      setError(e.message || "Failed to update config.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDeleteSelected() {
    const existing = savedConfigs.find((c) => c.id === selectedSavedId);
    if (!existing) return;
    setSaveBusy(true);
    setError(null);
    try {
      await deleteSavedConfig(existing.id);
      setSavedConfigs((prev) => prev.filter((c) => c.id !== existing.id));
      setSelectedSavedId("");
      setNotice(`Deleted "${existing.name}".`);
    } catch (e: any) {
      setError(e.message || "Failed to delete config.");
    } finally {
      setSaveBusy(false);
    }
  }

  /**
   * Downloads the currently selected saved config as a portable JSON file —
   * just {name, config}, no server round-trip needed. Anyone can hand this
   * file to a teammate, who imports it below to add it to their own
   * saved-configs list (or, if MongoDB is shared, it's already visible to
   * everyone anyway — this is for offline sharing, a different machine, or
   * before MongoDB is set up).
   */
  function handleDownloadSelected() {
    const existing = savedConfigs.find((c) => c.id === selectedSavedId);
    if (!existing) return;
    const payload = { name: existing.name, config: existing.config };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${existing.name.replace(/[^a-z0-9-_]/gi, "_")}.loadpilot-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfigFile(file: File | null) {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed?.config || !parsed?.name) {
        throw new Error("This doesn't look like a LoadPilot config file — expected {name, config}.");
      }
      setSaveBusy(true);
      const record = await createSavedConfig(parsed.name, parsed.config as BuildConfig);
      setSavedConfigs((prev) => [...prev, record].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSavedId(record.id);
      applyConfig(record.config);
      setNotice(`Imported "${record.name}" and loaded it into the form below.`);
    } catch (e: any) {
      setError(e.message || "Failed to import that file — make sure it's a config exported from LoadPilot.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleAutoCorrelate() {
    if (steps.length < 2) {
      return setError("Auto-detect needs at least 2 steps — add a step that might reuse a value from an earlier one.");
    }
    const validationError = validate();
    if (validationError) return setError(validationError);

    setError(null);
    setNotice(null);
    setCorrelateBusy(true);
    try {
      const result: AutoCorrelationResult = await autoCorrelate(buildConfig(), csvFile || undefined);
      if (result.correlations.length === 0) {
        setNotice("Ran a quick probe through your steps but didn't find any values being reused between them.");
        return;
      }

      // Apply to form
      setSteps((prev) =>
        prev.map((s, i) => {
          const match = result.correlations.find((c) => c.foundInStep === i + 1);
          if (!match) return s;
          return { ...s, extractVariableName: match.variableName, extractRegex: match.regex };
        })
      );

      // Build pre-fill text for the Correlation tab
      const prefill = result.correlations.map((c) =>
        `[Step ${c.foundInStep}] Response contains: ${c.variableName}\n` +
        `Extractor: ${c.regex}\n` +
        `Used in: Step ${c.usedInStep} — ${c.usedInDescription}`
      ).join("\n\n");
      if (onCorrelationReady) onCorrelationReady(prefill, "auto-detect");

      const summary = result.correlations
        .map((c) => `${c.variableName} (step ${c.foundInStep} → step ${c.usedInStep})`)
        .join(", ");
      setNotice(
        `Found ${result.correlations.length} correlation${result.correlations.length === 1 ? "" : "s"}: ${summary}. ` +
        `Applied extractors to the source steps.` +
        (onOpenCorrelation ? " Full details in the Correlation tab." : "")
      );
    } catch (e: any) {
      setError(e.message || "Auto-correlation failed.");
    } finally {
      setCorrelateBusy(false);
    }
  }

  /** Per-step list of secret-shaped header names / body values that aren't already marked sensitive. */
  function findUnflaggedSecrets(): { stepId: number; headerNames: string[]; bodyValues: string[] }[] {
    const results: { stepId: number; headerNames: string[]; bodyValues: string[] }[] = [];
    for (const s of steps) {
      const detectedHeaderNames = detectSensitiveHeaderNames(s.headers).filter(
        (name) => !s.headers.find((h) => h.name === name)?.sensitive
      );
      const detectedBodyValues = detectSensitiveBodyValues(s.body).filter((v) => !s.sensitiveValues.includes(v));
      if (detectedHeaderNames.length > 0 || detectedBodyValues.length > 0) {
        results.push({ stepId: s.id, headerNames: detectedHeaderNames, bodyValues: detectedBodyValues });
      }
    }
    return results;
  }

  /** Applies the detected markings to a steps array (used for both the persisted state update and the immediate config build, to avoid a stale-state race). */
  function markStepsAsSensitive(
    base: StepFormState[],
    perStep: { stepId: number; headerNames: string[]; bodyValues: string[] }[]
  ): StepFormState[] {
    return base.map((s) => {
      const det = perStep.find((d) => d.stepId === s.id);
      if (!det) return s;
      return {
        ...s,
        headers: s.headers.map((h) => (det.headerNames.includes(h.name) ? { ...h, sensitive: true } : h)),
        sensitiveValues: Array.from(new Set([...s.sensitiveValues, ...det.bodyValues])),
      };
    });
  }

  async function proceedWithGenerate(stepsOverride?: StepFormState[]) {
    setError(null);
    setNotice(null);
    setBusy("generate");
    try {
      const config = buildConfig(stepsOverride);
      const file = await downloadGeneratedJmx(config, csvFile || undefined);
      // Emit the JMX file to the parent so Script Review tab can use it
      if (file && onJmxGenerated) onJmxGenerated(file);
      setNotice(
        `Downloaded — open it in JMeter or run it from this app below.` +
        (onOpenReview ? " Script review is ready in the Script Review tab." : "")
      );
    } catch (e: any) {
      setError(e.message || "Failed to generate the .jmx file.");
    } finally {
      setBusy(null);
    }
  }

  async function proceedWithRun(stepsOverride?: StepFormState[]) {
    setError(null);
    setNotice(null);
    setBusy("run");

    // Check for expired JWTs in headers before starting
    const allHeaders = steps.flatMap(s => s.headers || []);
    const jwtWarning = checkJwtExpiry(allHeaders, Number(durationSeconds) || 60);
    if (jwtWarning) {
      setError(jwtWarning);
      setBusy(null);
      return;
    }

    try {
      const run = await createRun(buildConfig(stepsOverride), csvFile || undefined);
      onRunStarted(run);
    } catch (e: any) {
      setError(e.message || "Failed to start the run.");
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    const validationError = validate();
    if (validationError) return setError(validationError);
    const detections = findUnflaggedSecrets();
    if (detections.length > 0) {
      setSecretWarning({ action: "generate", perStep: detections });
      return;
    }
    await proceedWithGenerate();
  }

  async function handleRun() {
    const validationError = validate();
    if (validationError) return setError(validationError);
    const detections = findUnflaggedSecrets();
    if (detections.length > 0) {
      setSecretWarning({ action: "run", perStep: detections });
      return;
    }
    await proceedWithRun();
  }

  async function handleMarkAndContinue() {
    if (!secretWarning) return;
    const updatedSteps = markStepsAsSensitive(steps, secretWarning.perStep);
    setSteps(updatedSteps); // persist the markings for next time
    const action = secretWarning.action;
    setSecretWarning(null);
    if (action === "generate") await proceedWithGenerate(updatedSteps);
    else await proceedWithRun(updatedSteps);
  }

  async function handleContinueWithoutMarking() {
    if (!secretWarning) return;
    const action = secretWarning.action;
    setSecretWarning(null);
    if (action === "generate") await proceedWithGenerate();
    else await proceedWithRun();
  }

  // Variables available to step N = extract names from all steps before it.
  function availableVarsBeforeStep(index: number): string[] {
    return steps.slice(0, index).map((s) => s.extractVariableName.trim()).filter(Boolean);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Build &amp; Run</h2>
        <p className="muted">
          Fill in your endpoint and load settings below — no JMeter knowledge needed. You can
          generate a <code>.jmx</code> to run anywhere, or run it directly from here if JMeter is
          available on this server. Hover or tap the info icons if a field is unfamiliar.
        </p>
      </div>

      {jmeterStatus && (
        <div className={`alert ${jmeterStatus.available ? "ok" : "warn"}`}>
          {jmeterStatus.available
            ? `JMeter detected on this server (v${jmeterStatus.version || "unknown"}) — you can run tests directly.`
            : "JMeter was not found on this server — you can still generate a .jmx and run it wherever JMeter is installed."}
        </div>
      )}

      <SmartConfigBuilder onApply={applyConfig} onApplyParsed={applyParsedSuggestion} />

      <div className="card">
        <h3>Saved configs</h3>
        <div className="row">
          <select value={selectedSavedId} onChange={(e) => handleLoadSelected(e.target.value)}>
            <option value="">— Load a saved config —</option>
            {savedConfigs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.createdBy ? ` (${c.createdBy})` : ""}
              </option>
            ))}
          </select>
          {selectedSavedId && (
            <>
              <button className="small" onClick={handleUpdateSelected} disabled={saveBusy}>
                Update this one
              </button>
              <button className="small" onClick={handleDownloadSelected} disabled={saveBusy}>
                Download
              </button>
              <button className="small" onClick={handleDeleteSelected} disabled={saveBusy}>
                Delete
              </button>
            </>
          )}
        </div>
        <div className="row">
          <input
            placeholder="Name this config (e.g. Contractor Dashboard)"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <button className="small" onClick={handleSaveAsNew} disabled={saveBusy}>
            Save as new
          </button>
        </div>
        <div className="row">
          <label className="small import-file-label">
            Import a config file
            <input
              type="file"
              accept=".json"
              onChange={(e) => handleImportConfigFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        <p className="muted">
          Saves everything in the form below. Test-data CSV uploads aren't saved — re-upload them
          after loading a config that used one. <strong>Download</strong> exports the selected
          config as a file you can hand to a teammate or keep as a backup — note it includes
          everything in the config as-is, including any header values like API keys, so treat the
          downloaded file the same as you'd treat those credentials. <strong>Import</strong> adds
          a config file someone shared with you to your own saved list.
        </p>
      </div>

      <div className="card">
        <h3>1. Target</h3>
        <div className="form-grid">
          <label>
            <span className="label-text">
              Test name <FieldGuide guide={{
                title: "Test name",
                icon: "🏷️",
                what: "A label that appears in your saved configs list and run history so you can find this test again. It doesn't change anything about how the test actually runs.",
                when: "Name it after what you're testing, not the date — you can run it multiple times. A good name is something like 'AI Chatbot — Production' or 'Reactore Query API'.",
                example: { context: "Reactore AI chatbot testing", text: "AI chatbot Test — Concurrent 40 users" },
              }} />
            </span>
            <input value={testName} onChange={(e) => setTestName(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              Protocol <FieldGuide guide={{
                title: "Protocol",
                icon: "🔒",
                what: "Whether to connect securely (https) or not (http). Almost every real API today uses https — it's the secure, encrypted version.",
                when: "Always choose https unless your developer specifically told you the API only works over http. If you're not sure, try https first.",
                example: { context: "Reactore AI chatbot", text: "https — the Lambda URL starts with https://, so we pick https here." },
                chips: [
                  { label: "https", value: "https", hint: "Secure — correct for 99% of APIs" },
                  { label: "http", value: "http", hint: "Unencrypted — only if told to" },
                ],
              }} />
            </span>
            <select value={protocol} onChange={(e) => setProtocol(e.target.value as "http" | "https" | "ws" | "wss")}>
              <option value="https">https</option>
              <option value="http">http</option>
              <option value="wss">wss (WebSocket secure)</option>
              <option value="ws">ws (WebSocket)</option>
            </select>
          </label>
          <label>
            <span className="label-text">
              Host <FieldGuide guide={{
                title: "Host",
                icon: "🌐",
                what: "The address of the server you're sending requests to — the domain part only, without https:// at the start or any path after it.",
                when: "Copy the URL your developer gave you and paste just the domain part here. Everything before the first slash after https://.",
                example: { context: "Reactore AI chatbot Lambda URL", text: "bdmiuuyznlzn5z7ktngmvm2j4u0luhjf.lambda-url.ap-south-1.on.aws" },
              }} />
            </span>
            <input placeholder="api.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              Port (optional) <FieldGuide guide={{
                title: "Port (optional)",
                icon: "🚪",
                what: "A port is like a specific door on the server. Most public APIs use the default (443 for https, 80 for http) which means you leave this blank.",
                when: "Only fill this in if your developer gave you a URL with a number after a colon — like api.example.com:8443. The 8443 part is the port.",
                example: { context: "Internal APIs sometimes run on non-standard ports", text: "If the URL is api.internal.com:9000/query — put 9000 here, and /query in the Path field below." },
              }} />
            </span>
            <input placeholder="443" value={port} onChange={(e) => setPort(e.target.value)} />
          </label>
        </div>
        <p className="muted">
          One host is shared by every step below — this is the server you're load testing.
        </p>
      </div>

      <div className="card">
        <h3>
          2. Requests{" "}
          <FieldGuide guide={{
                title: "Steps",
                icon: "🔗",
                what: "Each step is one API request. Most tests only need one step — the same endpoint hit over and over by many users at once.",
                when: "Add a second step only if your test needs to chain requests together — for example, Step 1 logs in and gets a session token, Step 2 uses that token to call the actual API. The 'Save a value from this response' section on each step handles passing data between them.",
                example: { context: "Reactore AI chatbot", text: "One step — POST to the Lambda URL. No login step needed because authentication is handled by the x-api-key header." },
              }} />
        </h3>
        <p className="muted steps-hint">
          {steps.length === 1
            ? "Define the API request to test. Need to test a login → then call an API? Add a second step below."
            : `${steps.length} steps chained in sequence. Values extracted from one step's response can be referenced in the next step.`}
        </p>

        {steps.map((step, index) => {
          const availableVars = availableVarsBeforeStep(index);
          const previewUrl = `${protocol}://${domain.trim() || "your-host.com"}${port ? `:${port}` : ""}${
            step.path.trim() ? (step.path.trim().startsWith("/") ? step.path.trim() : `/${step.path.trim()}`) : "/"
          }`;

          return (
            <div key={step.id} className="step-card">
              <div className="step-card-head">
                <div className="step-card-head-left">
                  <strong>{steps.length > 1 ? `Step ${index + 1} of ${steps.length}` : "Request"}</strong>
                  {steps.length > 1 && index > 0 && availableVars.length > 0 && (
                    <span className="step-inherits-badge">
                      Can use: {availableVars.map(v => `\${${v}}`).join(", ")}
                    </span>
                  )}
                </div>
                {steps.length > 1 && (
                  <button className="small" onClick={() => removeStep(step.id)}>
                    Remove step
                  </button>
                )}
              </div>

              {steps.length > 1 && index === 0 && (
                <div className="multi-step-flow-guide">
                  <div className="multi-step-flow-icon">🔗</div>
                  <div>
                    <strong>Multi-step flow</strong>
                    <p className="muted">
                      You have {steps.length} steps chained together. Each step runs one after the other for every simulated user.
                      If Step 1's response contains a value that Step 2 needs (like a login token), use the
                      <strong> "Save a value from this response"</strong> section below — then reference it in Step 2 as <code>{"${variableName}"}</code>.
                    </p>
                  </div>
                </div>
              )}

              <div className="form-grid">
                {steps.length > 1 && (
                  <label>
                    <span className="label-text">
                      Step name <FieldGuide guide={{
                title: "Step name",
                icon: "📝",
                what: "An optional label for this request that appears in your run results. Without a name, it shows as 'Step 1', 'Step 2', etc.",
                when: "Give it a name if you have multiple steps and want the results table to show meaningful names instead of 'Step 1: POST'.",
                example: { context: "Multi-step flow", text: "Name your steps 'Login', 'Query AI', 'Logout' so the results are easy to read." },
              }} />
                    </span>
                    <input
                      placeholder={`Step ${index + 1}`}
                      value={step.name}
                      onChange={(e) => updateStep(step.id, { name: e.target.value })}
                    />
                  </label>
                )}
                <label>
                  <span className="label-text">
                    Method <FieldGuide guide={{
                title: "Method",
                icon: "📤",
                what: "The type of action you're asking the server to perform. Think of it like verbs — GET asks for information, POST sends new information, PUT/PATCH updates existing information, DELETE removes something.",
                when: "Your developer will tell you which method the endpoint uses. AI chatbot and query APIs almost always use POST because you're sending a question. Fetching a list of records uses GET.",
                example: { context: "Reactore AI chatbot", text: "POST — we're sending a query (question) to the server, not just retrieving data." },
                chips: [
                  { label: "POST", value: "POST", hint: "Send data to create or process something" },
                  { label: "GET", value: "GET", hint: "Retrieve data, no body needed" },
                  { label: "PUT", value: "PUT", hint: "Replace an existing record entirely" },
                  { label: "PATCH", value: "PATCH", hint: "Update part of an existing record" },
                ],
              }} />
                  </span>
                  <select
                    value={step.method}
                    onChange={(e) => updateStep(step.id, { method: e.target.value as BuildStep["method"] })}
                  >
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>PATCH</option>
                    <option>DELETE</option>
                  </select>
                </label>
                <label className="grow">
                  <span className="label-text">
                    Path <FieldGuide guide={{
                title: "Path",
                icon: "🛤️",
                what: "The specific address within the server you're calling — everything after the domain name. If the full URL is api.example.com/v1/orders, the path is /v1/orders.",
                when: "If the full URL your developer gave you is something like https://api.example.com/query, put /query here. If it's just the domain with nothing after it (like a Lambda URL), put / here.",
                example: { context: "Reactore AI chatbot Lambda URL", text: "/ — the Lambda URL has no path, just the domain, so path is just a forward slash." },
              }} />
                  </span>
                  <input
                    placeholder="/api/orders"
                    value={step.path}
                    onChange={(e) => updateStep(step.id, { path: e.target.value })}
                  />
                </label>
              </div>

              {availableVars.length > 0 && (
                <div className="row var-chip-row">
                  <span className="muted small-text">Insert into path:</span>
                  {availableVars.map((v) => (
                    <button key={v} className="small var-chip" onClick={() => insertVarIntoPath(step.id, v)}>
                      + ${"{" + v + "}"}
                    </button>
                  ))}
                </div>
              )}

              <p className="url-preview">
                Full URL: <code>{previewUrl}</code>
              </p>

              <div className="subsection">
                <div className="subsection-label-row">
                  <p className="subsection-label">
                    Headers{" "}
                    <FieldGuide guide={{
                title: "Headers",
                icon: "📋",
                what: "Extra information attached to every request — like showing your ID at the door before entering. The most common headers are Content-Type (telling the server you're sending JSON) and an authentication key (proving you're allowed to use the API).",
                when: "Almost every API needs at least Content-Type: application/json if you're sending a body. Any API that requires a login needs an authentication header too — your developer will tell you what it's called and what value to put.",
                example: { context: "Reactore AI chatbot", text: "Two headers: Content-Type: application/json (always needed) and x-api-key: your-key-here (proves you're authorised to use it)." },
              }} />
                  </p>
                  {!step.bulkEditMode ? (
                    <button className="small" onClick={() => enterBulkEdit(step.id)}>
                      Bulk edit
                    </button>
                  ) : (
                    <div className="row" style={{ margin: 0 }}>
                      <button className="small" onClick={() => cancelBulkEdit(step.id)}>
                        Cancel
                      </button>
                      <button className="small" onClick={() => applyBulkEdit(step.id)}>
                        Apply
                      </button>
                    </div>
                  )}
                </div>

                {step.bulkEditMode ? (
                  <>
                    <AutoTextarea
                      minRows={4}
                      value={step.bulkEditText}
                      onChange={(v) => updateStep(step.id, { bulkEditText: v })}
                      placeholder={"One per line, Name: Value\nContent-Type: application/json\nAuthorization: Bearer abc123"}
                    />
                    <p className="muted small-text">
                      Edit freely as text — delete a line to remove that header, add a line to add one. Click
                      Apply to save, or Cancel to discard.
                    </p>
                  </>
                ) : (
                  <>
                    <table className="field-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Value</th>
                          <th>Sensitive</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {step.headers.map((h) => (
                          <tr key={h.id}>
                            <td>
                              <input
                                value={h.name}
                                placeholder="Authorization"
                                onChange={(e) => updateStepHeader(step.id, h.id, { name: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={h.value}
                                placeholder="Bearer ${authToken}"
                                onChange={(e) => updateStepHeader(step.id, h.id, { value: e.target.value })}
                              />
                            </td>
                            <td className="sensitive-cell">
                              <input
                                type="checkbox"
                                checked={h.sensitive}
                                title="Mask this value in exported HTML reports"
                                onChange={(e) => updateStepHeader(step.id, h.id, { sensitive: e.target.checked })}
                              />
                            </td>
                            <td>
                              <button className="small" onClick={() => removeStepHeader(step.id, h.id)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button className="small" onClick={() => addStepHeader(step.id)}>
                      + Add header
                    </button>

                    <div className="paste-headers-row">
                      <AutoTextarea
                        minRows={2}
                        placeholder={"Paste raw headers here to auto-fill, e.g.:\nContent-Type: application/json\nAuthorization: Bearer abc123"}
                        value={step.headerPasteText}
                        onChange={(v) => updateStep(step.id, { headerPasteText: v })}
                      />
                      <button className="small" onClick={() => handleParseHeaders(step.id)} disabled={!step.headerPasteText.trim()}>
                        Parse &amp; add
                      </button>
                    </div>
                  </>
                )}
              </div>

              {BODY_METHODS.has(step.method) && (
                <div className="subsection">
                  <p className="subsection-label">
                    Body (raw JSON or text){" "}
                    <FieldGuide guide={{
                title: "Body",
                icon: "📦",
                what: 'The actual data payload you\'re sending to the server — like filling out a form before submitting it. For most APIs this is JSON format, which looks like { "key": "value" }.',
                when: "POST and PUT requests almost always need a body. GET requests typically don't. Copy a real example from your developer or from Postman — paste it here and replace any real values with ${variable} references if you want different data per user.",
                example: { context: "Reactore AI chatbot", text: '{ "user_id": "${user_id}", "query": "how many assets are present?", "application_name": "reactore" }' },
              }} />
                  </p>
                  <AutoTextarea
                    minRows={5}
                    value={step.body}
                    onChange={(v) => updateStep(step.id, { body: v })}
                    placeholder='{"userId": "${userId}"}'
                  />
                  {availableVars.length > 0 && (
                    <div className="row var-chip-row">
                      <span className="muted small-text">Insert into body:</span>
                      {availableVars.map((v) => (
                        <button key={v} className="small var-chip" onClick={() => insertVarIntoBody(step.id, v)}>
                          + ${"{" + v + "}"}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="sensitive-values-block">
                    <p className="subsection-label small-text">
                      Sensitive values in this body{" "}
                      <FieldGuide guide={{
                title: "Sensitive values in body",
                icon: "🔐",
                what: "If your body contains a real secret typed directly in (like a database password or connection string), paste that exact secret text here. It still gets sent for real during the test — but it gets replaced with ●●●●●●●● in any report you export.",
                when: "Use this when your body has something like mongodb://username:password@host or an API key typed directly into the JSON — not a ${variable} reference. If you're already using ${variable} references from your CSV, you don't need this.",
                example: { context: "Reactore AI chatbot", text: 'The mongodb_uri field in the body contains mongodb://readonly:readonly@13.53.36.39:27018 — paste that exact value here so it gets masked in shared reports.' },
              }} />
                    </p>
                    {step.sensitiveValues.length > 0 && (
                      <ul className="sensitive-values-list">
                        {step.sensitiveValues.map((v) => (
                          <li key={v}>
                            <code>{v.length > 60 ? v.slice(0, 60) + "…" : v}</code>
                            <button className="small" onClick={() => removeSensitiveValue(step.id, v)}>
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="row">
                      <input
                        placeholder="Paste the exact secret text, e.g. mongodb://user:pass@host:port"
                        value={step.newSensitiveValueInput}
                        onChange={(e) => updateStep(step.id, { newSensitiveValueInput: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && addSensitiveValue(step.id)}
                      />
                      <button className="small" onClick={() => addSensitiveValue(step.id)}>
                        + Mark as sensitive
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="subsection">
                <p className="subsection-label">
                  Pass/fail criteria{" "}
                  <FieldGuide guide={{
                title: "Pass / fail criteria",
                icon: "✅",
                what: "These are the rules that decide whether each request counts as a success or failure in your results. Without any rules, even a completely wrong response looks like a pass.",
                when: "Always set at least the expected status code (usually 200). Add a max response time if speed matters to your users. Add a JSON field check if you want to catch cases where the server returns 200 but the response content is wrong.",
                example: { context: "Reactore AI chatbot", text: "Expected status 200, max response time 30000ms — anything slower than 30 seconds or returning a 4xx/5xx code counts as a failure." },
              }} />
                </p>
                <div className="form-grid">
                  <label>
                    <span className="label-text">
                      Expected status code{" "}
                      <FieldGuide guide={{
                title: "Expected status code",
                icon: "🔢",
                what: "Every server response includes a three-digit code saying what happened. 200 means 'everything worked.' 4xx codes mean the request was wrong (403 = not allowed, 404 = not found). 5xx codes mean the server had a problem (502 = server crashed, 503 = server overloaded).",
                when: "Always fill this in. Put 200 for almost everything. If your developer says certain endpoints return 201 (created) or 204 (no content), put those instead — or list multiple with commas: 200, 201.",
                example: { context: "Reactore AI chatbot", text: "200 — the Lambda should return HTTP 200 with the AI response in the body. Any 502 means AWS Lambda crashed." },
                chips: [
                  { label: "200 OK", value: "200", hint: "Standard success for most GET/POST" },
                  { label: "201 Created", value: "201", hint: "When creating a new record" },
                  { label: "200, 201", value: "200, 201", hint: "Accept either success code" },
                  { label: "204 No content", value: "204", hint: "Success with no response body" },
                ],
              }} />
                    </span>
                    <input
                      placeholder="200"
                      value={step.expectedStatusCode}
                      onChange={(e) => updateStep(step.id, { expectedStatusCode: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="label-text">
                      Max response time (ms, optional){" "}
                      <FieldGuide guide={{
                title: "Max response time",
                icon: "⏱️",
                what: "Sets a speed limit for each request. If the server takes longer than this to respond, it counts as a failure in your results — even if the status code was 200 (success). Measured in milliseconds (1000ms = 1 second).",
                when: "Set this based on what's acceptable to your end users. For an AI chatbot that's known to take 10-30 seconds, you might set 45000 (45 seconds). For a fast data lookup API, you might set 2000 (2 seconds).",
                example: { context: "Reactore AI chatbot", text: "30000 (30 seconds) — the AI processing is slow by nature, but anything over 30 seconds means something is wrong." },
                chips: [
                  { label: "2 sec", value: "2000", hint: "Fast API, data lookups" },
                  { label: "5 sec", value: "5000", hint: "Normal web API response" },
                  { label: "15 sec", value: "15000", hint: "Complex processing" },
                  { label: "30 sec", value: "30000", hint: "AI / LLM endpoints" },
                ],
              }} />
                    </span>
                    <input
                      value={step.maxResponseTimeMs}
                      placeholder="e.g. 3000"
                      onChange={(e) => updateStep(step.id, { maxResponseTimeMs: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="label-text">
                      Check JSON field (path){" "}
                      <FieldGuide guide={{
                title: "Check JSON field",
                icon: "🔍",
                what: "Checks that a specific piece of information in the JSON response has exactly the value you expect. A server can return HTTP 200 (success) but still have the wrong content — this catches that.",
                when: "Use this when a 200 status code alone isn't enough to know the request worked. For example, some APIs return 200 with an error message in the body when something goes wrong.",
                example: { context: "Reactore AI chatbot", text: "$.answer — checks that the response has an 'answer' field, meaning the AI actually returned something instead of an empty response." },
              }} />
                    </span>
                    <input
                      value={step.jsonPath}
                      placeholder="e.g. $.status"
                      onChange={(e) => updateStep(step.id, { jsonPath: e.target.value })}
                    />
                  </label>
                  {step.jsonPath.trim() && (
                    <label>
                      <span className="label-text">
                        …equals (optional){" "}
                        <FieldGuide guide={{
                title: "…equals",
                icon: "🎯",
                what: "The exact text that field should contain. If left blank, the check just verifies the field exists in the response at all.",
                when: "Fill this in when you know exactly what value to expect. Leave it blank if you just want to confirm the field exists (useful for checking that $.answer has something, without knowing what the answer will be).",
                example: { context: "Status check API", text: "If the field is $.status and you put 'success' here, any response where status is 'error' or 'pending' counts as a failure." },
              }} />
                      </span>
                      <input
                        value={step.jsonPathExpected}
                        placeholder='e.g. ok'
                        onChange={(e) => updateStep(step.id, { jsonPathExpected: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="subsection">
                <p className="subsection-label">
                  Save a value from this response for later steps (optional){" "}
                  <FieldGuide guide={{
                    title: "Save a value for later steps",
                    icon: "📌",
                    what: "Pulls a specific piece of data out of this response and saves it so the next step can use it. The classic example is a login step that returns a session token — you save the token here, then the next step sends it as a header.",
                    when: "Only needed in multi-step tests where one request depends on the output of a previous one. If you only have one step, skip this entirely.",
                    example: { context: "Login → API flow", text: "Step 1 logs in, response contains { 'token': 'abc123' }. Save $.token as 'authToken'. Step 2 sends header: Authorization: Bearer ${authToken}." },
                  }} />
                </p>
                <div className="form-grid">
                  <label>
                    <span className="label-text">
                      Save as variable{" "}
                      <FieldGuide guide={{
                        title: "Save as variable",
                        icon: "🏷️",
                        what: "The name you give this saved value. It becomes a placeholder you can use anywhere in later steps by wrapping it in ${ }.",
                        when: "Name it after what the value represents — authToken, sessionId, userId. Avoid generic names like 'value1'.",
                        example: { context: "Login → AI chatbot flow", text: "Name it 'sessionToken'. Then in Step 2's headers, put: x-session-id: ${sessionToken}" },
                      }} />
                    </span>
                    <input
                      placeholder="authToken"
                      value={step.extractVariableName}
                      onChange={(e) => updateStep(step.id, { extractVariableName: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="label-text">
                      How to find it{" "}
                      <FieldGuide guide={{
                title: "How to find it",
                icon: "🔎",
                what: "Two ways to locate a value in the response. JSON field (recommended): write a path like $.token and it finds that exact field in the JSON response — simple and reliable. Pattern match: use a search pattern if the response isn't JSON or the field is in an unusual place.",
                when: "Choose JSON field for any API that returns JSON (which is almost all modern APIs). Only use Pattern match for XML responses, HTML, or unusual formats.",
                example: { context: "JSON API response", text: "Response is { 'auth': { 'token': 'abc123' } } → use JSON field with path $.auth.token" },
              }} />
                    </span>
                    <select
                      value={step.extractType}
                      onChange={(e) => updateStep(step.id, { extractType: e.target.value as "regex" | "jsonpath" })}
                    >
                      <option value="jsonpath">JSON field (recommended for JSON APIs)</option>
                      <option value="regex">Pattern match (Regex)</option>
                    </select>
                  </label>
                  {step.extractType === "jsonpath" ? (
                    <label className="grow">
                      <span className="label-text">
                        JSON field path{" "}
                        <FieldGuide guide={{
                title: "JSON field path",
                icon: "🗺️",
                what: "The path to the value inside the JSON response, using dots to go deeper and [0] to access the first item in a list. Always starts with $. which means 'the whole response'.",
                when: "Read the response body from a test run (or ask your developer for an example response) and trace the path to the value you want to save.",
                example: { context: "Common patterns", text: "$.token (top level), $.data.sessionId (one level deep), $.users[0].id (first user's ID in a list), $.result.auth.bearer (deeply nested)" },
              }} />
                      </span>
                      <input
                        placeholder="e.g. $.auth.token"
                        value={step.extractJsonPath}
                        onChange={(e) => updateStep(step.id, { extractJsonPath: e.target.value })}
                      />
                    </label>
                  ) : (
                    <label className="grow">
                      <span className="label-text">
                        Pattern (wrap the value in parentheses){" "}
                        <FieldGuide guide={{
                title: "Pattern (Regex)",
                icon: "🔤",
                what: "A search pattern where you put parentheses around the piece you want to capture. Everything outside the parentheses is just the surrounding text that helps locate the right value.",
                when: "Use this when the response isn't JSON (like XML or HTML), or when the value appears in a format that's hard to express as a JSON path.",
                example: { context: "JSON response (alternative to JSON path)", text: '"token":"([^"]+)" — the ([^"]+) part captures everything between the quotes after token. The captured value is what gets saved.' },
              }} />
                      </span>
                      <input
                        placeholder='"token":"([^"]+)"'
                        value={step.extractRegex}
                        onChange={(e) => updateStep(step.id, { extractRegex: e.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    <span className="label-text">
                      Fallback value if not found{" "}
                      <FieldGuide guide={{
                title: "Fallback value",
                icon: "🛟",
                what: "What to use if the field or pattern can't be found in the response. Mainly useful for debugging — if later steps receive this fallback instead of the real value, you know the extraction didn't work.",
                when: "Set it to something obvious like NOT_FOUND so it's immediately visible in your results if extraction fails. Leave blank if you'd rather it just be empty.",
                example: { context: "Debugging tip", text: "Set fallback to NOT_FOUND. If your Step 2 header shows x-session-id: NOT_FOUND in the results, you know Step 1's extraction failed." },
                chips: [
                  { label: "NOT_FOUND", value: "NOT_FOUND", hint: "Makes failures easy to spot" },
                  { label: "ERROR", value: "ERROR", hint: "Alternative obvious marker" },
                ],
              }} />
                    </span>
                    <input
                      placeholder="e.g. NOT_FOUND"
                      value={step.extractDefaultValue}
                      onChange={(e) => updateStep(step.id, { extractDefaultValue: e.target.value })}
                    />
                  </label>
                </div>
                {step.extractVariableName.trim() && (
                  <p className="muted small-text">
                    Later steps can reference this as{" "}
                    <code>${"{" + step.extractVariableName.trim() + "}"}</code>
                  </p>
                )}
              </div>

              <div className="subsection">
                <p className="subsection-label">
                  Group this step into a transaction (optional){" "}
                  <FieldGuide guide={{
                title: "Transaction grouping",
                icon: "📊",
                what: "Groups related steps together and records their combined time as a single result row, in addition to each step's individual row. Useful for measuring a complete user journey as one unit.",
                when: "Use this when you have 2-3 steps that together make up one 'action' from a user's point of view. For example, Login + Get Profile might together be 'User Sign-in' and you want to know the total time for that complete action.",
                example: { context: "E-commerce flow", text: "Steps 1 and 2 are both part of 'Checkout Flow'. Results show Step 1 (2.1s), Step 2 (0.8s), and Checkout Flow (2.9s total)." },
              }} />
                </p>
                <div className="form-grid">
                  <label>
                    <span className="label-text">
                      Transaction name (optional){" "}
                      <FieldGuide guide={{
                title: "Transaction name",
                icon: "🏷️",
                what: "The name of the group this step belongs to. Every step with the same name gets grouped together into one transaction.",
                when: "Use the same name on all steps that form one logical user action. Any step left blank stays ungrouped.",
                example: { context: "AI chatbot multi-step test", text: "Give Steps 1 and 2 the name 'AI Query Flow'. Your results will show individual step rows plus an 'AI Query Flow' row with the combined time." },
              }} />
                    </span>
                    <input
                      placeholder="e.g. Login Flow"
                      value={step.transactionName}
                      onChange={(e) => updateStep(step.id, { transactionName: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            </div>
          );
        })}

        <div className="row">
          <button className="small" onClick={addStep}>
            + Add another step (multi-step flow)
          </button>
          {steps.length > 1 && (
            <button
              className="small auto-correlate-btn"
              onClick={handleAutoCorrelate}
              disabled={correlateBusy || !jmeterStatus?.available}
              title={
                !jmeterStatus?.available
                  ? "Needs JMeter on this server — it runs one real request through your steps to see what's actually reused"
                  : ""
              }
            >
              {correlateBusy ? "Running a quick probe…" : "✨ Auto-detect correlations"}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3>3. Load settings</h3>

        <div className="form-grid" style={{ marginBottom: 16 }}>
          <label>
            <span className="label-text">
              Test type{" "}
              <FieldGuide guide={{
                title: "Test type",
                icon: "🧪",
                what: "Determines the shape of the load — how many users, when they arrive, and how load changes over the test. Each type answers a different question about your API's performance.",
                when: "Start with Load test for most purposes. Use Soak to check for gradual degradation over hours. Use Spike to check resilience to sudden bursts. Use Step-Up to find the exact breaking point.",
                example: { context: "Reactore AI chatbot", text: "Load test: 'Can 10 users use it simultaneously for 2 minutes?' Spike: 'What happens if 40 users suddenly pile on during a presentation?'" },
              }} />
            </span>
            <select value={testType} onChange={(e) => setTestType(e.target.value)}>
              <option value="load">🔵 Load test — steady users for a fixed time (most common)</option>
              <option value="soak">🟡 Soak test — lighter load for hours, spot slow leaks</option>
              <option value="spike">🔴 Spike test — normal load + sudden burst, check resilience</option>
              <option value="stepup">🟢 Step-Up test — users increase in steps, find the breaking point</option>
              <option value="breakpoint">⚫ Breakpoint test — ramp up until it fails, find the limit</option>
            </select>
          </label>
        </div>

        {testType === "soak" && (
          <div className="alert ok" style={{ marginBottom: 12, fontSize: 12 }}>
            <strong>Soak test</strong> — Set a long Duration (e.g. 4–8 hours = 14400–28800 seconds) with moderate users. Reveals memory leaks, connection pool exhaustion, and performance that degrades gradually over time. Run it overnight and check the chart for gradually worsening response times.
          </div>
        )}

        {testType === "breakpoint" && (
          <div className="alert warn" style={{ marginBottom: 12, fontSize: 12 }}>
            <strong>Breakpoint test</strong> — Set a high user count and very long duration. Watch the Run Report live and stop the test manually (Stop button) when errors appear. The user count at that moment is your system's breaking point. Useful for capacity planning.
          </div>
        )}

        {testType === "spike" && (
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="subsection-label">Spike configuration</p>
            <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Runs two groups simultaneously: a steady base load throughout, plus a short spike of extra users that starts after a delay. Tests whether your system can handle a sudden traffic burst and recover.</p>
            <div className="form-grid">
              <label><span className="label-text">Base users (constant)</span>
                <input type="number" min={1} value={spikeBaseUsers} onChange={(e) => setSpikeBaseUsers(e.target.value)} />
              </label>
              <label><span className="label-text">Spike users (extra burst)</span>
                <input type="number" min={1} value={spikeUsers} onChange={(e) => setSpikeUsers(e.target.value)} />
              </label>
              <label><span className="label-text">Spike starts after (seconds)</span>
                <input type="number" min={0} value={spikeStartSeconds} onChange={(e) => setSpikeStartSeconds(e.target.value)} />
              </label>
              <label><span className="label-text">Spike lasts (seconds)</span>
                <input type="number" min={1} value={spikeDurationSeconds} onChange={(e) => setSpikeDurationSeconds(e.target.value)} />
              </label>
            </div>
            <p className="muted small-text" style={{ marginTop: 8 }}>
              Total test duration: ~{Number(spikeStartSeconds) + Number(spikeDurationSeconds) + 30}s. Users field below is ignored for spike tests — use Base users and Spike users above.
            </p>
          </div>
        )}

        {testType === "stepup" && (
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="subsection-label">Step-Up configuration</p>
            <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Adds a new wave of users at regular intervals. Each wave runs for the remaining test duration. Shows exactly at which user count performance starts degrading.</p>
            <div className="form-grid">
              <label><span className="label-text">Number of steps</span>
                <input type="number" min={2} max={10} value={stepCount} onChange={(e) => setStepCount(e.target.value)} />
              </label>
              <label><span className="label-text">Users added per step</span>
                <input type="number" min={1} value={stepUsers} onChange={(e) => setStepUsers(e.target.value)} />
              </label>
              <label><span className="label-text">Each step lasts (seconds)</span>
                <input type="number" min={10} value={stepDurationSeconds} onChange={(e) => setStepDurationSeconds(e.target.value)} />
              </label>
              <label><span className="label-text">Ramp-up per step (seconds)</span>
                <input type="number" min={0} value={stepRamp} onChange={(e) => setStepRamp(e.target.value)} />
              </label>
            </div>
            <p className="muted small-text" style={{ marginTop: 8 }}>
              Total: {stepCount} steps × {stepUsers} users = {Number(stepCount) * Number(stepUsers)} peak users. Duration: ~{Number(stepCount) * Number(stepDurationSeconds)}s total.
            </p>
          </div>
        )}
        <div className="presets-row">
          <span className="muted small-text">Quick presets:</span>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button key={key} className="small" onClick={() => applyPreset(key as keyof typeof PRESETS)}>
              {p.label}
            </button>
          ))}
          {customPresets.map((p, i) => (
            <span key={i} className="custom-preset-chip">
              <button className="small preset-custom" onClick={() => applyPresetConfig(p)} title={`${p.users} users, ${p.rampUpSeconds}s ramp, ${p.durationSeconds}s duration`}>
                {p.label}
              </button>
              <button className="small preset-delete" onClick={() => deleteCustomPreset(i)} title="Delete this preset">×</button>
            </span>
          ))}
          {!showSavePreset ? (
            <button className="small" onClick={() => setShowSavePreset(true)}>+ Save current as preset</button>
          ) : (
            <span className="preset-save-row">
              <input
                autoFocus
                placeholder="Preset name"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveCustomPreset(); if (e.key === "Escape") setShowSavePreset(false); }}
              />
              <button className="small" onClick={saveCustomPreset} disabled={!newPresetName.trim()}>Save</button>
              <button className="small" onClick={() => setShowSavePreset(false)}>Cancel</button>
            </span>
          )}
        </div>
        <div className="form-grid">
          <label>
            <span className="label-text">
              Users (concurrent) <FieldGuide guide={{
                title: "Users (concurrent)",
                icon: "👥",
                what: "How many people you're simulating using the API at the exact same time. This is the single most important load setting — it determines how much pressure you're putting on the server.",
                when: "Think about your real-world peak load. How many people actually use this API simultaneously at the busiest moment? Start with a number close to reality, not a fantasy stress number.",
                example: { context: "Reactore AI chatbot", text: "10 team members might all query the chatbot during the same meeting — set to 10 for a realistic test, 40 to stress-test the limit." },
                chips: [
                  { label: "1 user", value: "1", hint: "Smoke test — just checking it works" },
                  { label: "5 users", value: "5", hint: "Light load — small team" },
                  { label: "10 users", value: "10", hint: "Realistic team usage" },
                  { label: "40 users", value: "40", hint: "Heavy concurrent load" },
                ],
              }} />
            </span>
            <input type="number" min={1} value={users} onChange={(e) => setUsers(Number(e.target.value))} />
          </label>
          <label>
            <span className="label-text">
              Ramp-up (seconds) <FieldGuide guide={{
                title: "Ramp-up (seconds)",
                icon: "📈",
                what: "How long it takes to gradually bring all users online, instead of all of them hitting the server at the exact same second. Spreading the startup simulates more natural user behaviour.",
                when: "Set this to roughly the same as your user count (e.g. 10 users → 10 seconds ramp-up) for a natural feel. Set it to 0 only when you specifically want everyone to hit the server simultaneously — which is very aggressive and unrealistic unless that's intentional.",
                example: { context: "10 users, realistic test", text: "Ramp-up of 10 seconds: one new user joins every second for 10 seconds until all 10 are active. Compare to 0 ramp-up which slams all 10 in at once." },
                chips: [
                  { label: "0s", value: "0", hint: "All users at once — aggressive" },
                  { label: "10s", value: "10", hint: "1 user per second for 10 users" },
                  { label: "30s", value: "30", hint: "Gentle ramp for larger tests" },
                  { label: "60s", value: "60", hint: "Slow build — most realistic" },
                ],
              }} />
            </span>
            <input type="number" min={0} value={rampUpSeconds} onChange={(e) => setRampUpSeconds(Number(e.target.value))} />
          </label>
          <label>
            <span className="label-text">
              Duration (seconds){" "}
              <FieldGuide guide={{
                title: "Duration (seconds)",
                icon: "⏳",
                what: "How long the test keeps running at full load. Each user sends requests continuously for this entire duration — so with 10 users and 60 seconds, you might get 30-100 total requests depending on how fast the server responds.",
                when: "Run for at least 60 seconds to get meaningful data — anything shorter and you won't see how the server holds up under sustained load. For AI endpoints with slow responses, 120-300 seconds is better. Not used when Loop count is set.",
                example: { context: "Reactore AI chatbot", text: "120 seconds (2 minutes) — long enough to see if response times change under sustained load, not so long it wastes time." },
                chips: [
                  { label: "30s", value: "30", hint: "Quick smoke test" },
                  { label: "60s", value: "60", hint: "Standard short test" },
                  { label: "120s", value: "120", hint: "Sustained load test" },
                  { label: "300s", value: "300", hint: "5-minute endurance test" },
                ],
              }} />
            </span>
            <input
              type="number"
              min={1}
              value={durationSeconds}
              disabled={Boolean(loopCount)}
              onChange={(e) => setDurationSeconds(Number(e.target.value))}
            />
          </label>
          <label>
            <span className="label-text">
              Loop count (optional){" "}
              <FieldGuide guide={{
                title: "Loop count",
                icon: "🔁",
                what: "How many times each user sends the request before stopping. Normally the test runs for a fixed duration and each user sends as many requests as they can. Loop count flips this to 'each user sends exactly N requests then stops'.",
                when: "Set to 1 when you want every user to fire the API exactly once — useful for measuring the effect of a burst of simultaneous first-time requests. Leave blank for normal time-based testing.",
                example: { context: "40 users, all fire once", text: "40 users + Loop count 1 + Ramp-up 0 + Synchronizing Timer = all 40 users fire simultaneously, exactly one request each, then the test ends." },
                chips: [
                  { label: "Once", value: "1", hint: "Each user fires exactly once" },
                  { label: "5 times", value: "5", hint: "Each user fires 5 requests" },
                  { label: "10 times", value: "10", hint: "Each user fires 10 requests" },
                ],
              }} />
            </span>
            <input
              type="number"
              min={1}
              value={loopCount}
              placeholder="e.g. 1"
              onChange={(e) => {
                setLoopCount(e.target.value);
              }}
            />
          </label>
          <label>
            <span className="label-text">
              Think time (ms, optional){" "}
              <FieldGuide guide={{
                title: "Think time",
                icon: "💭",
                what: "A pause inserted between requests, simulating the time a real person takes to read a response before making the next request. Without any pause, JMeter sends requests back-to-back as fast as possible — not realistic for real users.",
                when: "Use when your response times are fairly predictable and you want to control the pace of requests. Leave blank if you're using Max throughput instead — they solve the same problem and shouldn't be used together.",
                example: { context: "Reactore AI chatbot", text: "Leave blank and use Max throughput: 40 instead — the AI response times vary widely (10-30s) so a fixed think time would give unpredictable throughput." },
                chips: [
                  { label: "1s", value: "1000", hint: "Minimal pause" },
                  { label: "3s", value: "3000", hint: "Quick reader" },
                  { label: "10s", value: "10000", hint: "Normal reading time" },
                  { label: "20s", value: "20000", hint: "Slow/careful user" },
                ],
              }} />
            </span>
            <input
              value={thinkTimeMs}
              placeholder="e.g. 2000"
              onChange={(e) => setThinkTimeMs(e.target.value)}
              disabled={Boolean(targetThroughputPerMinute)}
            />
          </label>
          <label>
            <span className="label-text">
              + Random delay (ms, optional){" "}
              <FieldGuide guide={{
                title: "+ Random delay",
                icon: "🎲",
                what: "Adds a random extra wait on top of Think time, making the pause different every time instead of always exactly the same. Real people don't read at a perfectly uniform speed — this makes the simulation more realistic.",
                when: "Use alongside Think time when you want natural variation in request timing. If Think time is 2000ms and Random delay is 3000ms, each pause will be somewhere between 2 and 5 seconds, randomly chosen.",
                example: { context: "Simulating real users", text: "Think time 2000 + Random delay 3000 = pauses randomly between 2 and 5 seconds. Much more realistic than a rigid 2-second pause every time." },
              }} />
            </span>
            <input
              value={thinkTimeRandomMs}
              placeholder="e.g. 3000"
              onChange={(e) => setThinkTimeRandomMs(e.target.value)}
              disabled={Boolean(targetThroughputPerMinute)}
            />
          </label>
          <label>
            <span className="label-text">
              Max throughput (requests/minute, optional){" "}
              <FieldGuide guide={{
                title: "Max throughput (req/min)",
                icon: "🚦",
                what: "Caps the total number of requests per minute across ALL users combined. Instead of you calculating a fixed pause to hit a target rate, JMeter automatically adjusts the wait time — shorter when responses are slow, longer when they're fast — to keep the rate near your target.",
                when: "Use when you have a hard 'never exceed X requests per minute' requirement AND your response times vary (like an AI endpoint that sometimes takes 10s and sometimes 30s). A fixed Think time with variable response times gives unpredictable throughput; this doesn't.",
                example: { context: "Reactore AI chatbot", text: "Max throughput 40 with 10 users: JMeter ensures no more than 40 requests total per minute go to the Lambda, regardless of whether responses take 10 or 25 seconds." },
                chips: [
                  { label: "10 /min", value: "10", hint: "Very conservative rate" },
                  { label: "20 /min", value: "20", hint: "Light load" },
                  { label: "40 /min", value: "40", hint: "Reactore chatbot limit" },
                  { label: "60 /min", value: "60", hint: "1 per second, shared" },
                ],
              }} />
            </span>
            <input
              value={targetThroughputPerMinute}
              placeholder="e.g. 40"
              onChange={(e) => {
                setTargetThroughputPerMinute(e.target.value);
                if (e.target.value) {
                  setThinkTimeMs("");
                  setThinkTimeRandomMs("");
                }
              }}
            />
          </label>
          <label>
            <span className="label-text">
              If a request fails{" "}
              <FieldGuide guide={{
                title: "If a request fails",
                icon: "🚨",
                what: "What each simulated user does after one of their requests fails a pass/fail check. Note: JMeter triggers this on the very first failure — there's no 'stop after N failures' setting built into JMeter.",
                when: "Keep going (default) is fine for most tests — you want to see the full picture of failures, not stop early. Use 'Stop that user' if a session-based API becomes unusable once one request fails (the session is broken). Use 'Stop whole test' when any failure means the system is completely down.",
                example: { context: "Reactore AI chatbot", text: "Keep going — a 502 from AWS Lambda doesn't mean all users are affected. You want to see how many requests failed vs succeeded in total." },
              }} />
            </span>
            <select value={onError} onChange={(e) => setOnError(e.target.value as typeof onError)}>
              <option value="continue">Keep going (default)</option>
              <option value="stopthread">Stop that user, others continue</option>
              <option value="stoptest">Stop the whole test (let current requests finish)</option>
              <option value="stoptestnow">Stop the whole test immediately</option>
            </select>
          </label>
        </div>

        <div className="subsection" style={{ marginTop: 16 }}>
          <p className="subsection-label">Advanced options</p>
          <div className="form-grid">
            <label className="checkbox-row">
              <input type="checkbox" checked={cookieManager} onChange={(e) => setCookieManager(e.target.checked)} />
              <span>
                Cookie Manager{" "}
                <FieldGuide guide={{
                title: "Cookie Manager",
                icon: "🍪",
                what: "Automatically captures cookies from each response and sends them back on every subsequent request — exactly like a web browser does. Without this, cookies are ignored completely.",
                when: "Enable if your API uses cookie-based sessions (you log in through a browser, and the server sets a session cookie). Disable if your API uses header tokens (Authorization: Bearer ...) — which is most modern APIs including Reactore. When in doubt, leave it off.",
                example: { context: "Traditional web app vs API", text: "A banking web application where you log in and the server sets a JSESSIONID cookie — enable Cookie Manager. Reactore AI chatbot uses an x-api-key header — no Cookie Manager needed." },
              }} />
              </span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={syncTimerEnabled}
                onChange={(e) => {
                  setSyncTimerEnabled(e.target.checked);
                  if (e.target.checked && !syncTimerGroupSize) setSyncTimerGroupSize(String(users));
                }}
              />
              <span>
                Synchronizing Timer{" "}
                <FieldGuide guide={{
                title: "Synchronizing Timer",
                icon: "🏁",
                what: "Holds every simulated user at a starting line until all of them are ready, then releases them all at the exact same millisecond. More precise than ramp-up=0 — that starts threads together but the first one to finish initialising fires slightly ahead of the rest.",
                when: "Enable when you need all users to hit the API genuinely simultaneously — like testing what happens when 40 people all click 'submit' at the exact same second. Combine with Loop count=1 for 'everyone fires once at the same time' tests.",
                example: { context: "40-user simultaneous test", text: "40 users + Ramp-up 0 + Loop count 1 + Synchronizing Timer (group=40): all 40 fire at the exact same millisecond, once each, then the test ends." },
              }} />
              </span>
            </label>
            {syncTimerEnabled && (
              <>
                <label>
                  <span className="label-text">
                    Release when this many users are ready{" "}
                    <FieldGuide guide={{
                title: "Release when this many are ready",
                icon: "👥",
                what: "How many users must be ready before the barrier releases. Set this to the same number as your Users field to make all of them fire simultaneously. Set it lower if you want users released in batches.",
                when: "Almost always set this equal to your Users count. The only reason to set it lower is if you want waves of simultaneous requests rather than one single burst.",
                example: { context: "40-user simultaneous test", text: "40 users, group size 40 → all 40 fire together. Group size 10 → released in 4 waves of 10 as they become ready." },
              }} />
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={syncTimerGroupSize}
                    placeholder={String(users)}
                    onChange={(e) => setSyncTimerGroupSize(e.target.value)}
                  />
                </label>
                <label>
                  <span className="label-text">
                    Max wait time (ms, 0 = forever){" "}
                    <FieldGuide guide={{
                title: "Max wait time",
                icon: "⌛",
                what: "Safety timeout — if the full group doesn't form within this time, JMeter releases whoever is ready anyway. 0 means wait forever, which is fine for small thread counts.",
                when: "For small tests (under 50 users), 0 (wait forever) is fine. For large tests, set 5000-10000 (5-10 seconds) so the test doesn't hang if some threads are slow to start.",
                example: { context: "40-user simultaneous test", text: "5000ms (5 seconds) — if all 40 users don't get ready within 5 seconds, release whoever is ready. Prevents the test from hanging forever." },
                chips: [
                  { label: "0 (forever)", value: "0", hint: "Safe for small tests" },
                  { label: "5 sec", value: "5000", hint: "Good for 50-100 users" },
                  { label: "10 sec", value: "10000", hint: "Large user counts" },
                ],
              }} />
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={syncTimerTimeout}
                    placeholder="0"
                    onChange={(e) => setSyncTimerTimeout(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>4. Test data (optional)</h3>
        <p className="muted">
          Upload a CSV (e.g. from the Test Data Generator tab) to drive varied values, so each
          simulated user can use a different value instead of repeating the exact same request.
        </p>
        <div className="csv-upload-row">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => handleCsvSelected(e.target.files?.[0] || null)}
          />
          {csvFile && (
            <button
              className="small danger-btn"
              onClick={() => {
                handleCsvSelected(null);
                // Reset the file input visually
                const inp = document.querySelector("input[type='file'][accept='.csv']") as HTMLInputElement;
                if (inp) inp.value = "";
              }}
              title="Remove uploaded file"
            >
              ✕ Remove {csvFile.name}
            </button>
          )}
        </div>
        {csvVariables.length > 0 && (
          <p className="muted">
            Detected variables: {csvVariables.map((v) => `\${${v}}`).join(", ")} — paste these into any
            path/body/header field above.
          </p>
        )}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={stickyPerUser}
            onChange={(e) => setStickyPerUser(e.target.checked)}
          />
          <span>
            Keep each simulated user on the same row for their whole session{" "}
            <FieldGuide guide={{
                title: "Keep each user on the same row",
                icon: "📌",
                what: "Controls whether each simulated user stays with the same CSV row throughout the test or picks a new one each time. Off (default) = each request can use any row. On = each user claims one row at the start and sticks with it.",
                when: "Turn ON when your CSV has identity pairs that belong together — like user_id + session_id for the same person. If user_001's session_id gets mixed with user_002's user_id, the server will reject it. Turn OFF when rows are independent (e.g. different search queries, no relationship between columns).",
                example: { context: "Reactore AI chatbot", text: "CSV has user_id and session_id pairs. Turn ON — user_001's thread must always use session_id abc123 (its own session), never session_id from another row." },
              }} />
          </span>
        </label>
      </div>

      <div className="card">
        <h3>5. Performance thresholds (optional)</h3>
        <p className="muted">
          Define what counts as each performance level for this test, so the results analysis
          and exported report can rate each request against your own targets instead of a
          generic default. Only "Good up to" is required — the rest fill in automatically if
          left blank. Leave everything blank to use general-purpose defaults.
        </p>
        <p className="subsection-label" style={{marginTop: "12px"}}>Response time (p95)</p>
        <div className="form-grid">
          <label>
            <span className="label-text">
              Excellent up to (ms){" "}
              <FieldGuide guide={{
                title: "Excellent up to (ms)",
                icon: "🌟",
                what: "The response time below which performance is considered excellent — 95% of requests must finish this fast or faster. Auto-filled as 60% of your 'Good' threshold if you leave it blank.",
                when: "Set based on what you'd consider a genuinely great user experience for this specific API. Leave blank and it's auto-calculated.",
                example: { context: "Standard web API", text: "300ms — responses under 300ms feel instant to users." },
                chips: [
                  { label: "200ms", value: "200", hint: "Very fast API" },
                  { label: "500ms", value: "500", hint: "Fast web API" },
                  { label: "5s", value: "5000", hint: "AI/complex endpoints" },
                ],
              }} />
            </span>
            <input value={excellentMs} placeholder="auto" onChange={(e) => setExcellentMs(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              Good up to (ms){" "}
              <FieldGuide guide={{
                title: "Good up to (ms)",
                icon: "✅",
                what: "The only required threshold. 95% of requests must complete within this time to be rated 'Good'. This is the main benchmark everything else is compared against.",
                when: "Set this to the response time you'd be happy with in production. For typical APIs 500ms is good. For AI endpoints that process complex queries, 10-15 seconds might be your 'good' threshold.",
                example: { context: "Reactore AI chatbot", text: "8000ms (8 seconds) — if 95% of requests finish within 8 seconds, the AI chatbot is performing acceptably." },
                chips: [
                  { label: "500ms", value: "500", hint: "Fast data APIs" },
                  { label: "2s", value: "2000", hint: "Standard web services" },
                  { label: "8s", value: "8000", hint: "AI / LLM endpoints" },
                  { label: "15s", value: "15000", hint: "Heavy processing APIs" },
                ],
              }} />
            </span>
            <input value={goodMs} placeholder="e.g. 500" onChange={(e) => setGoodMs(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              Acceptable up to (ms){" "}
              <FieldGuide guide={{
                title: "Acceptable up to (ms)",
                icon: "🟡",
                what: "Response times in this range are usable but noticeably slow — users will feel the wait. Auto-filled as the midpoint between Good and Degraded if left blank.",
                when: "Leave blank for auto-calculation, or set it to the response time where you'd say 'it works, but it's a bit slow'.",
                example: { context: "Reactore AI chatbot", text: "15000ms (15 seconds) — still usable but users will notice the wait. Above this is where people start getting frustrated." },
              }} />
            </span>
            <input value={acceptableMs} placeholder="auto" onChange={(e) => setAcceptableMs(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              Degraded up to (ms){" "}
              <FieldGuide guide={{
                title: "Degraded up to (ms)",
                icon: "🟠",
                what: "Response times in this range mean the system is under strain and users are frustrated. Anything slower than this is rated 'Poor'. Auto-filled if left blank.",
                when: "Set this to the response time where you'd say 'this is unacceptably slow — something is wrong'. Anything above this rating is shown in red.",
                example: { context: "Reactore AI chatbot", text: "25000ms (25 seconds) — above 25 seconds we'd consider this a degraded experience. Above this = poor (shown in red)." },
              }} />
            </span>
            <input value={degradedMs} placeholder="e.g. 2000" onChange={(e) => setDegradedMs(e.target.value)} />
          </label>
        </div>
        <p className="subsection-label" style={{marginTop: "14px"}}>Error rate</p>
        <div className="form-grid">
          <label>
            <span className="label-text">
              Acceptable error rate (%){" "}
              <FieldGuide guide={{
                title: "Acceptable error rate (%)",
                icon: "✅",
                what: "The error percentage below which the error rate is considered acceptable. For example, 1 means up to 1% of requests can fail and still be rated 'ok'.",
                when: "For production APIs, 0-1% error rate is typically acceptable. Set it to match your team's agreed service level (SLA).",
                example: { context: "AI chatbot SLA", text: "2% — we're okay with 2 failures per 100 requests under load. Our SLA is 98% success rate." },
                chips: [
                  { label: "0%", value: "0", hint: "Zero tolerance for errors" },
                  { label: "1%", value: "1", hint: "Standard SLA" },
                  { label: "2%", value: "2", hint: "Slightly lenient" },
                  { label: "5%", value: "5", hint: "Exploratory testing" },
                ],
              }} />
            </span>
            <input value={acceptableErrorPct} placeholder="e.g. 1" onChange={(e) => setAcceptableErrorPct(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              Warning error rate (%){" "}
              <FieldGuide guide={{
                title: "Warning error rate (%)",
                icon: "⚠️",
                what: "Error rates above the acceptable threshold but below this are shown as 'warning'. Error rates above this are 'critical' (shown in red).",
                when: "Set this to the error rate where you'd escalate the issue to the team immediately. Anything above this should trigger an alert.",
                example: { context: "AI chatbot", text: "10% — if more than 1 in 10 requests fails, that's a critical issue needing immediate investigation. Between 2-10% is a warning to investigate." },
                chips: [
                  { label: "5%", value: "5", hint: "Standard warning threshold" },
                  { label: "10%", value: "10", hint: "Higher tolerance" },
                  { label: "20%", value: "20", hint: "Very lenient (exploratory)" },
                ],
              }} />
            </span>
            <input value={warningErrorPct} placeholder="e.g. 5" onChange={(e) => setWarningErrorPct(e.target.value)} />
          </label>
        </div>
      </div>

      {error && <ErrorAlert error={error} />}
      {notice && <div className="alert ok">{notice}</div>}

      {secretWarning && (
        <div className="alert warn secret-warning">
          <p>
            <strong>This looks like it might contain secrets:</strong>
          </p>
          <ul className="secret-warning-list">
            {secretWarning.perStep.map((d, i) => (
              <li key={i}>
                {d.headerNames.map((n) => (
                  <span key={n} className="secret-warning-item">
                    header <code>{n}</code>
                  </span>
                ))}
                {d.bodyValues.map((v, j) => (
                  <span key={j} className="secret-warning-item">
                    body value <code>{v.length > 50 ? v.slice(0, 50) + "…" : v}</code>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="muted">
            Marking these sensitive masks them in the "external" exported report later (it
            doesn't change anything about how the test actually runs). You can always
            mark/unmark manually afterward too.
          </p>
          <div className="row">
            <button className="small" onClick={handleContinueWithoutMarking}>
              Continue without marking
            </button>
            <button className="small" onClick={handleMarkAndContinue}>
              Mark sensitive &amp; continue
            </button>
          </div>
        </div>
      )}

      <ProbeRequest
        protocol={protocol}
        domain={domain}
        port={port ? Number(port) : undefined}
        path={steps[0]?.path || "/"}
        method={steps[0]?.method || "GET"}
        headers={steps[0]?.headers || []}
        body={steps[0]?.body || ""}
      />

      <div className="sticky-actions">
        <button className="small" onClick={handleGenerate} disabled={busy !== null}>
          {busy === "generate" ? "Generating…" : "Generate .jmx"}
        </button>
        <button onClick={handleRun} disabled={busy !== null || !jmeterStatus?.available}>
          {busy === "run" ? "Starting…" : "Run Test"}
        </button>
        {jmeterStatus && !jmeterStatus.available && (
          <span className="muted">Run Test is disabled until JMeter is available on this server.</span>
        )}
      </div>
    </div>
  );
});
