import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import { getRun, listRuns, runDownloadUrl, runReportHtmlUrl, stopRun, deleteRun, labelRun } from "../api";
import { RunRecord } from "../types";
import { resolveSteps } from "../configUtils";
import ProgressTracker from "./ProgressTracker";
import CallsView from "./CallsView";
import RunCompareView from "./RunCompareView";
import LiveDashboard from "./LiveDashboard";
import { explainLoadSettings } from "../utils/explainLoadSettings";

const ResponseTimeChart = lazy(() => import("./ResponseTimeChart"));

const ACTIVE_STATUSES = new Set(["queued", "running"]);

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function RunReportTab({
  selectedRunId,
  onSelectRun,
  onRerunConfig,
  onOpenResults,
  onOpenCorrelation,
  onOpenReview,
}: {
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  onRerunConfig?: (config: any) => void;
  onOpenResults?: (runId: string) => void;
  onOpenCorrelation?: (prefill: string) => void;
  onOpenReview?: (file: File) => void;
}) {
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logView, setLogView] = useState<"log" | "chart" | "calls">("log");
  const [reportView, setReportView] = useState<"overview" | "deepdive">("overview");
  const [compareId, setCompareId] = useState<string>("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editLabelId, setEditLabelId] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState("");
  const [completionFlash, setCompletionFlash] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Reset views when a different run is selected or a run completes
  useEffect(() => {
    setReportView("deepdive");
    setLogView("log");
    setDeleteConfirmId(null);
    setEditLabelId(null);
    setCompletionFlash(false);
    prevStatusRef.current = null;
  }, [selectedRunId]);

  function refreshHistory() {
    listRuns()
      .then(setHistory)
      .catch(() => {});
  }

  useEffect(() => {
    refreshHistory();
    const interval = setInterval(refreshHistory, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setRun(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      try {
        const r = await getRun(selectedRunId!);
        if (cancelled) return;

        // Detect running → completed transition — show banner only, stay on deep dive
        if (
          prevStatusRef.current &&
          ACTIVE_STATUSES.has(prevStatusRef.current) &&
          !ACTIVE_STATUSES.has(r.status)
        ) {
          setCompletionFlash(true);
          setTimeout(() => setCompletionFlash(false), 2500);
        }
        prevStatusRef.current = r.status;

        setRun(r);
        setError(null);
        if (!ACTIVE_STATUSES.has(r.status) && timer) {
          clearInterval(timer);
          refreshHistory();
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load run.");
      }
    }

    poll();
    timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.logTail.length]);

  async function handleStop() {
    if (!run) return;
    try {
      await stopRun(run.id);
    } catch (e: any) {
      setError(e.message || "Failed to stop run.");
    }
  }

  const configSteps = run ? resolveSteps(run.config) : [];

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Run Report</h2>
        <p className="muted">
          Live status while running, then a full report once complete — Overview for sharing,
          Deep dive for debugging.
        </p>
      </div>

      <div className={`run-layout ${historyCollapsed ? "run-layout--history-collapsed" : ""}`}>
        <aside className={`run-history ${historyCollapsed ? "run-history--collapsed" : ""}`}>
          <div className="run-history-header">
            {!historyCollapsed && <h4>History</h4>}
            <button
              className="run-history-collapse-btn"
              onClick={() => setHistoryCollapsed(v => !v)}
              title={historyCollapsed ? "Show history" : "Hide history"}
            >
              {historyCollapsed ? "›" : "‹"}
            </button>
          </div>

          {!historyCollapsed && (
            <>
              {history.length > 0 && (
                <input
                  className="history-search"
                  type="text"
                  placeholder="Search runs…"
                  value={historySearch}
                  onChange={(e) => { setHistorySearch(e.target.value); setHistoryShowAll(true); }}
                />
              )}
              {history.length === 0 && (
                <p className="muted">No runs yet — start one from Build &amp; Run.</p>
              )}
              <ul>
                {(() => {
                  const filtered = historySearch.trim()
                    ? history.filter((r) => (r.runLabel || r.testName).toLowerCase().includes(historySearch.toLowerCase()))
                    : history;
                  const visible = historyShowAll || historySearch.trim() ? filtered : filtered.slice(0, 5);
                  return (
                    <>
                      {visible.map((r) => (
                        <li key={r.id} className={`${r.id === selectedRunId ? "active" : ""} run-history-item`}>
                          <div className="run-history-main" onClick={() => onSelectRun(r.id)}>
                            <span className={`status-dot status-${r.status}`} />
                            <div className="run-history-text">
                              {editLabelId === r.id ? (
                                <input
                                  autoFocus
                                  className="run-label-input"
                                  value={editLabelValue}
                                  placeholder="Label this run…"
                                  onChange={(e) => setEditLabelValue(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter") {
                                      await labelRun(r.id, editLabelValue);
                                      setEditLabelId(null);
                                      refreshHistory();
                                    }
                                    if (e.key === "Escape") setEditLabelId(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div className="run-name">{r.runLabel || r.testName}</div>
                              )}
                              <div className="muted small-text">
                                {new Date(r.createdAt).toLocaleString()}
                                {r.createdBy ? ` · ${r.createdBy}` : ""}
                              </div>
                            </div>
                          </div>
                          {deleteConfirmId === r.id ? (
                            <div className="run-delete-confirm" onClick={(e) => e.stopPropagation()}>
                              <span className="muted small-text">Delete?</span>
                              <button className="small danger-btn" onClick={async () => {
                                await deleteRun(r.id);
                                setDeleteConfirmId(null);
                                if (selectedRunId === r.id) onSelectRun("");
                                refreshHistory();
                              }}>Yes</button>
                              <button className="small" onClick={() => setDeleteConfirmId(null)}>No</button>
                            </div>
                          ) : (
                            <div className="run-history-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="icon-btn" title="Rename" onClick={() => { setEditLabelId(r.id); setEditLabelValue(r.runLabel || ""); }}>✏️</button>
                              {onRerunConfig && <button className="icon-btn" title="Re-run this config" onClick={() => onRerunConfig(r.config)}>▶</button>}
                              <button className="icon-btn danger" title="Delete" onClick={() => setDeleteConfirmId(r.id)}>🗑</button>
                            </div>
                          )}
                        </li>
                      ))}
                      {!historySearch.trim() && filtered.length > 5 && (
                        <li className="history-show-more" onClick={() => setHistoryShowAll(v => !v)}>
                          {historyShowAll ? "Show less" : `+${filtered.length - 5} more — show all`}
                        </li>
                      )}
                      {historySearch.trim() && filtered.length === 0 && (
                        <p className="muted small-text">No runs match "{historySearch}"</p>
                      )}
                    </>
                  );
                })()}
              </ul>
            </>
          )}
        </aside>

        <div className="run-detail">
          {!run && (
            <div className="card">
              <p className="muted">Select a run from the history, or start one from Build &amp; Run.</p>
            </div>
          )}

          {run && (
            <>
              {/* Run header */}
              <div className="card">
                <div className="run-header">
                  <div>
                    <h3>{run.runLabel || run.testName}</h3>
                    <p className="muted">
                      {run.config.protocol}://{run.config.domain}
                      {run.config.port ? `:${run.config.port}` : ""} ·{" "}
                      {configSteps.length === 1
                        ? `${configSteps[0].method} ${configSteps[0].path}`
                        : `${configSteps.length} steps: ${configSteps.map((s) => s.path).join(" → ")}`}
                      {run.createdBy ? ` · started by ${run.createdBy}` : ""}
                    </p>
                  </div>
                  <div className="run-header-right">
                    <span className={`badge status-badge status-${run.status}`}>{statusLabel(run.status)}</span>
                    {run.status === "completed" && (
                      <div className="view-toggle report-view-toggle">
                        <button
                          className={`toggle-btn ${reportView === "overview" ? "active" : ""}`}
                          onClick={() => setReportView("overview")}
                          title="Plain-English summary — good for sharing"
                        >
                          Overview
                        </button>
                        <button
                          className={`toggle-btn ${reportView === "deepdive" ? "active" : ""}`}
                          onClick={() => setReportView("deepdive")}
                          title="Full numbers and log — good for debugging"
                        >
                          Deep dive
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="row">
                  {ACTIVE_STATUSES.has(run.status) && (
                    <button className="small" onClick={handleStop}>Stop</button>
                  )}
                  <a className="small button-link" href={runDownloadUrl(run.id, "jmx")}>Download .jmx</a>
                  {run.status === "completed" && (
                    <>
                      <a className="small button-link" href={runDownloadUrl(run.id, "jtl")}>Download .jtl</a>
                      <a className="small button-link report-link-external" href={runReportHtmlUrl(run.id, "external")} title="Secrets masked — safe to share">Report (external)</a>
                      <a className="small button-link report-link-internal" href={runReportHtmlUrl(run.id, "internal")} title="Full detail — team use only">Report (internal)</a>
                    </>
                  )}
                </div>
              </div>

              {error && <ErrorAlert error={error} />}
              {run.error && <ErrorAlert error={run.error} />}

              <ProgressTracker run={run} />

              {/* Live dashboard during active runs */}
              {ACTIVE_STATUSES.has(run.status) && (
                <div className="card">
                  <LiveDashboard
                    runId={run.id}
                    onComplete={() => {
                      // The polling useEffect will pick up the completed state
                    }}
                  />
                </div>
              )}

              {/* Completion banner — shown briefly when run transitions from running → complete */}
              {completionFlash && (
                <div className="completion-banner">
                  <span className="completion-banner-icon">✓</span>
                  <span>Test finished — loading your results…</span>
                </div>
              )}

              {/* OVERVIEW — shown when completed */}
              {reportView === "overview" && run.status === "completed" && (
                <>
                  {/* Verdict + key metrics */}
                  {run.jtlStats && run.jtlStats.length > 0 && run.analysis && (
                    <div className="card verdict-card">
                      <h3>What happened</h3>
                      <p className="verdict-text">{run.analysis.summary}</p>
                      <div className="key-metrics">
                        {run.jtlStats.slice(0, 1).map((s) => [
                          { label: "Total requests", value: String(s.samples) },
                          { label: "Error rate", value: `${s.errorPct.toFixed(1)}%`, bad: s.errorPct > 5 },
                          { label: "Avg response", value: `${s.avgMs}ms` },
                          { label: "p95 response", value: `${s.p95Ms}ms` },
                          {
                            label: "Rating",
                            value: s.performanceRating,
                            color: s.performanceRating === "excellent" ? "#3ecfbb"
                              : s.performanceRating === "good" ? "#4fb6a8"
                              : s.performanceRating === "acceptable" ? "#e8a33d"
                              : "#e5564b",
                          },
                        ]).flat().map((m: any, i: number) => (
                          <div key={i} className="key-metric">
                            <div
                              className={`key-metric-value ${m.bad ? "metric-bad" : ""}`}
                              style={m.color ? { color: m.color } : {}}
                            >
                              {m.value}
                            </div>
                            <div className="key-metric-label">{m.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {(run.analysis?.recommendations?.length ?? 0) > 0 && (
                    <div className="card">
                      <h3>What to do next</h3>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                        {run.analysis!.recommendations.map((r: string, i: number) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Load settings explained */}
                  <div className="card">
                    <h3>Load settings used</h3>
                    <div className="load-settings-explained">
                      {explainLoadSettings(run.config).map((row, i) => (
                        <div key={i} className="load-setting-explained-row">
                          <div className="load-setting-explained-header">
                            <span className="load-setting-explained-label">{row.label}</span>
                            <span className="load-setting-explained-value">{row.value}</span>
                          </div>
                          <p className="load-setting-explained-meaning muted">{row.meaning}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Navigation grid */}
                  <div className="card overview-nav-card">
                    <h3>Explore further</h3>
                    <div className="overview-nav-grid">
                      <button className="overview-nav-btn" onClick={() => setReportView("deepdive")}>
                        <div className="overview-nav-icon">📊</div>
                        <div className="overview-nav-label">Deep dive</div>
                        <div className="overview-nav-desc muted">Full numbers — p90/p95/p99, error breakdown, request log</div>
                      </button>
                      {onOpenResults && (
                        <button className="overview-nav-btn" onClick={() => onOpenResults(run.id)}>
                          <div className="overview-nav-icon">🤖</div>
                          <div className="overview-nav-label">AI analysis</div>
                          <div className="overview-nav-desc muted">Detailed AI diagnosis of bottlenecks and root causes</div>
                        </button>
                      )}
                      {onOpenCorrelation && (
                        <button className="overview-nav-btn" onClick={() => {
                          const prefill = `Run: ${run.testName}\nURL: ${run.config.protocol}://${run.config.domain}\n\nPaste your recorded request/response pairs below to detect correlations.`;
                          onOpenCorrelation(prefill);
                        }}>
                          <div className="overview-nav-icon">🔗</div>
                          <div className="overview-nav-label">Correlation</div>
                          <div className="overview-nav-desc muted">Find values that need to be captured between steps</div>
                        </button>
                      )}
                      {onOpenReview && (
                        <button className="overview-nav-btn" onClick={async () => {
                          try {
                            const res = await fetch(`/api/runs/${run.id}/download/jmx`);
                            if (res.ok) {
                              const blob = await res.blob();
                              onOpenReview(new File([blob], `${run.testName}.jmx`, { type: "application/xml" }));
                            }
                          } catch { /* ignore */ }
                        }}>
                          <div className="overview-nav-icon">🔍</div>
                          <div className="overview-nav-label">Script review</div>
                          <div className="overview-nav-desc muted">Check the test plan for common mistakes</div>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* DEEP DIVE — log/chart/calls + full table + error breakdown */}
              {(reportView === "deepdive" || run.status === "running" || run.status === "queued") && (
                <>
                  {(run.logTail.length > 0 || run.jtlStats) && (
                    <div className="card">
                      <div className="view-toggle">
                        <button className={`toggle-btn ${logView === "log" ? "active" : ""}`} onClick={() => setLogView("log")}>Log</button>
                        <button className={`toggle-btn ${logView === "chart" ? "active" : ""}`} onClick={() => setLogView("chart")} disabled={!run.jtlStats} title={!run.jtlStats ? "Available once results are processed" : ""}>Chart</button>
                        <button className={`toggle-btn ${logView === "calls" ? "active" : ""}`} onClick={() => setLogView("calls")} disabled={run.status !== "completed" && run.status !== "failed"} title={run.status === "running" ? "Available once the run finishes" : ""}>Calls</button>
                      </div>
                      {logView === "log" ? (
                        run.logTail.length > 0
                          ? <div className="log-viewer" ref={logRef}>{run.logTail.map((line, i) => <div key={i}>{line}</div>)}</div>
                          : <p className="muted">No log output yet.</p>
                      ) : logView === "chart" ? (
                        run.jtlStats
                          ? <Suspense fallback={<p className="muted">Loading chart…</p>}><ResponseTimeChart stats={run.jtlStats} /></Suspense>
                          : <p className="muted">Chart available once results are processed.</p>
                      ) : (
                        <CallsView runId={run.id} />
                      )}
                    </div>
                  )}

                  {run.jtlStats && run.jtlStats.length > 0 && (
                    <div className="card">
                      <h3>Results by label</h3>
                      <div className="table-scroll">
                        <table style={{ tableLayout: "fixed", width: "100%", minWidth: 720 }}>
                          <colgroup>
                            <col style={{ width: "22%" }} />
                            <col style={{ width: "9%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "7%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "8%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>Label</th>
                              <th>Samples</th>
                              <th>Err %</th>
                              <th>Min</th>
                              <th>Avg</th>
                              <th>Max</th>
                              <th>p90</th>
                              <th>p95</th>
                              <th>p99</th>
                              <th>Req/s</th>
                              <th>Rating</th>
                              <th>Errors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {run.jtlStats.map((s, i) => (
                              <tr key={i}>
                                <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</td>
                                <td className="num-mono">{s.samples}</td>
                                <td className={s.errorPct > 5 ? "num-bad" : "num-mono"}>{s.errorPct.toFixed(1)}%</td>
                                <td className="num-mono">{s.minMs}</td>
                                <td className="num-mono">{s.avgMs}</td>
                                <td className="num-mono">{s.maxMs}</td>
                                <td className="num-mono">{s.p90Ms}</td>
                                <td className="num-mono">{s.p95Ms}</td>
                                <td className="num-mono">{s.p99Ms}</td>
                                <td className="num-mono">{s.throughputPerSec.toFixed(2)}</td>
                                <td><span className={`rating-badge rating-${s.performanceRating}`}>{s.performanceRating}</span></td>
                                <td><span className={`rating-badge rating-${s.errorRating}`}>{s.errorRating}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Error breakdown */}
                  {run.jtlStats?.some(s => s.errorBreakdown?.length > 0) && (
                    <div className="card">
                      <h3>Error breakdown</h3>
                      {run.jtlStats.filter(s => s.errorBreakdown?.length > 0).map((s, si) => (
                        <div key={si} className="error-group">
                          <strong>{s.label}</strong>
                          <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
                            {s.errorBreakdown.map((e, ei) => (
                              <li key={ei} style={{ borderLeft: "3px solid var(--accent-red)", paddingLeft: 12, marginBottom: 8 }}>
                                <span className="badge">{e.responseCode}</span>{" "}
                                {e.count} request{e.count !== 1 ? "s" : ""}
                                {e.sampleMessage && (
                                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                                    {e.sampleMessage}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Run comparison */}
                  {run.status === "completed" && history.filter(r => r.id !== run.id && r.status === "completed").length > 0 && (
                    <div className="card">
                      <h3>Compare with another run</h3>
                      <select
                        value={compareId}
                        onChange={e => setCompareId(e.target.value)}
                        style={{ marginBottom: 12 }}
                      >
                        <option value="">— Select a run to compare against —</option>
                        {history
                          .filter(r => r.id !== run.id && r.status === "completed")
                          .map(r => (
                            <option key={r.id} value={r.id}>
                              {r.runLabel || r.testName} — {new Date(r.createdAt).toLocaleString()}
                            </option>
                          ))}
                      </select>
                      {compareId && (() => {
                        const compareRun = history.find(r => r.id === compareId);
                        return compareRun ? <RunCompareView runA={run} runB={compareRun} /> : null;
                      })()}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
