export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
}

export interface ErrorBreakdownEntry {
  responseCode: string;
  count: number;
  sampleMessage: string;
  sampleResponseBody?: string;
}

export interface TimeSeriesPoint {
  t: number;
  avgMs: number;
  errorCount: number;
  sampleCount: number;
}

export type PerformanceRating = "excellent" | "good" | "acceptable" | "degraded" | "poor";
export type ErrorRating = "ok" | "warning" | "critical";

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
  performanceRating: PerformanceRating;
  errorRating: ErrorRating;
}

export interface CallRecord {
  index: number;
  relativeMs: number;
  label: string;
  responseCode: string;
  success: boolean;
  elapsed: number;
  bytes: number;
  failureMessage: string | null;
  responseBody: string | null;
  threads: number;
}

export interface CallsPage {
  calls: CallRecord[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

export interface Bottleneck {
  label: string;
  observation: string;
  likelyCause: string;
  severity: "high" | "medium" | "low";
}

export interface ResultsAnalysisResponse {
  stats: LabelStats[];
  analysis: {
    summary: string;
    bottlenecks: Bottleneck[];
    recommendations: string[];
  };
  usage: Usage;
  cost: number;
  model: string;
}

export interface Correlation {
  variableName: string;
  foundIn: string;
  extractorType: string;
  expression: string;
  usedIn: string;
  usedInField: string;
}

export interface CorrelationResponse {
  correlations: Correlation[];
  notes: string;
  usage: Usage;
  cost: number;
  model: string;
}

export interface TestDataField {
  name: string;
  type?: string;
  description?: string;
}

export interface TestDataResponse {
  rows: Record<string, any>[];
  csv: string;
  requested: number;
  generated: number;
  usage: Usage;
  cost: number;
  model: string;
  cappedAt?: number;
}

export interface ThreadGroupInfo {
  name: string;
  numThreads: number;
  rampTime: number;
  loops: string;
}

export interface SamplerInfo {
  name: string;
  hasAssertion: boolean;
  hasExtractor: boolean;
}

export interface ListenerInfo {
  name: string;
  enabled: boolean;
}

export interface JmxFacts {
  threadGroups: ThreadGroupInfo[];
  samplers: SamplerInfo[];
  timers: number;
  listeners: ListenerInfo[];
  csvDataSets: number;
  suspiciousValues: { samplerName: string; value: string }[];
}

export interface ScriptIssue {
  severity: "high" | "medium" | "low";
  scope: string;
  issue: string;
  recommendation: string;
}

export interface ScriptReviewResponse {
  facts: JmxFacts;
  review: {
    issues: ScriptIssue[];
    summary: string;
  };
  usage: Usage;
  cost: number;
  model: string;
}

export interface SavedConfig {
  id: string;
  name: string;
  config: BuildConfig;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface ApiError {
  error: string;
}

export interface BuildHeader {
  name: string;
  value: string;
  sensitive?: boolean;
}

export interface BuildAssertions {
  expectedStatusCode?: string;
  maxResponseTimeMs?: number;
  jsonPath?: string;
  jsonPathExpected?: string;
}

export interface BuildExtract {
  variableName: string;
  type?: "regex" | "jsonpath";
  regex?: string;
  jsonPath?: string;
  defaultValue?: string;
}

export interface BuildStep {
  name?: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers: BuildHeader[];
  body?: string;
  assertions?: BuildAssertions;
  extract?: BuildExtract;
  sensitiveValues?: string[];
  transactionName?: string;
}

export type TestType = "load" | "soak" | "spike" | "stepup" | "breakpoint";

export interface SpikeConfig {
  baseUsers: number;
  spikeUsers: number;
  spikeStartSeconds: number;
  spikeDurationSeconds: number;
}

export interface StepUpConfig {
  stepsCount: number;
  usersPerStep: number;
  stepDurationSeconds: number;
  rampPerStep: number;
}

export interface BuildConfig {
  testName: string;
  protocol: "http" | "https" | "ws" | "wss";
  domain: string;
  port?: number;
  testType?: TestType;
  spikeConfig?: SpikeConfig;
  stepUpConfig?: StepUpConfig;
  steps?: BuildStep[];
  // Legacy single-request fields, kept for configs saved before multi-step existed.
  method?: BuildStep["method"];
  path?: string;
  headers?: BuildHeader[];
  body?: string;
  assertions?: BuildAssertions;
  load: {
    users: number;
    rampUpSeconds: number;
    durationSeconds: number;
    thinkTimeMs?: number;
    thinkTimeRandomMs?: number;
    targetThroughputPerMinute?: number;
    loopCount?: number;
    syncTimer?: { groupSize: number; timeoutInMs?: number };
    onError?: "continue" | "stopthread" | "stoptest" | "stoptestnow";
  };
  csv?: {
    filename: string;
    variableNames: string[];
    stickyPerUser?: boolean;
  };
  performanceThresholds?: {
    excellentMs?: number;
    goodMs: number;
    acceptableMs?: number;
    degradedMs?: number;
    moderateMs?: number;
    acceptableErrorPct?: number;
    warningErrorPct?: number;
  };
  cookieManager?: boolean;
}

export interface JmeterStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface RunRecord {
  id: string;
  testName: string;
  runLabel?: string;
  config: BuildConfig;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  logTail: string[];
  error?: string;
  jtlStats?: LabelStats[];
  analysis?: {
    summary: string;
    bottlenecks: Bottleneck[];
    recommendations: string[];
  };
  reviewFacts?: JmxFacts;
  review?: {
    issues: ScriptIssue[];
    summary: string;
  };
  usage?: Usage;
  cost?: number;
  createdBy?: string;
}

export interface AutoCorrelation {
  variableName: string;
  foundInStep: number;
  regex: string;
  usedInStep: number;
  usedInDescription: string;
}

export interface AutoCorrelationResult {
  correlations: AutoCorrelation[];
  stepCount: number;
  log: string[];
}

export interface ParsedConfigSuggestion {
  testName: string | null;
  protocol: "https" | "http" | null;
  domain: string | null;
  port: number | null;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | null;
  path: string | null;
  headers: { name: string; value: string }[];
  body: string | null;
  expectedStatusCode: string | null;
  maxResponseTimeMs: number | null;
  users: number | null;
  rampUpSeconds: number | null;
  durationSeconds: number | null;
  thinkTimeMs: number | null;
  onError: "continue" | "stopthread" | "stoptest" | "stoptestnow" | null;
  suggestedCsvVariables: string[];
}

export interface ParsedConfigResponse {
  config: ParsedConfigSuggestion;
  notes: string;
}
