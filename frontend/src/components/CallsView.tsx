import { useEffect, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import { getRunCalls } from "../api";
import { CallRecord, CallsPage } from "../types";
import { parseAssertionMessage } from "../utils/parseAssertionMessage";

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `+${m}m ${s % 60}s`;
  return `+${s}s`;
}

function responseCodeColor(code: string): string {
  const n = Number(code);
  if (n >= 200 && n < 300) return "code-2xx";
  if (n >= 300 && n < 400) return "code-3xx";
  if (n >= 400 && n < 500) return "code-4xx";
  if (n >= 500) return "code-5xx";
  return "code-other";
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function CallRow({ call }: { call: CallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(call.failureMessage || call.responseBody);

  return (
    <>
      <tr
        className={call.success ? "call-row-ok" : "call-row-fail"}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        style={hasDetail ? { cursor: "pointer" } : undefined}
        title={hasDetail ? (expanded ? "Click to collapse" : "Click to expand response") : undefined}
      >
        <td className="call-index">{call.index}</td>
        <td className="call-time">{formatRelative(call.relativeMs)}</td>
        <td className="call-label">{call.label}</td>
        <td>
          <span className={`call-code ${responseCodeColor(call.responseCode)}`}>
            {call.responseCode}
          </span>
        </td>
        <td className="call-elapsed">{formatMs(call.elapsed)}</td>
        <td className="call-bytes">{call.bytes > 0 ? `${(call.bytes / 1024).toFixed(1)}KB` : "—"}</td>
        <td className="call-threads">{call.threads}</td>
        <td className="call-expand-hint">
          {hasDetail && (
            <span className="expand-toggle">{expanded ? "▲" : "▼"}</span>
          )}
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr className={call.success ? "call-row-ok call-detail-row" : "call-row-fail call-detail-row"}>
          <td colSpan={8} className="call-detail-cell">
            {call.responseBody && (
              <div className="call-detail-section">
                <div className="call-detail-label">Server response body</div>
                <pre className="call-detail-body">{tryPrettyJson(call.responseBody)}</pre>
              </div>
            )}
            {call.failureMessage && (
              <div className="call-detail-section">
                <div className="call-detail-label">Assertion failure</div>
                <div className="call-detail-friendly">{parseAssertionMessage(call.failureMessage)}</div>
                <details className="call-detail-raw-wrap">
                  <summary className="call-detail-raw-toggle">Raw JMeter message</summary>
                  <pre className="call-detail-body call-detail-assertion">{call.failureMessage}</pre>
                </details>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function CallsView({ runId }: { runId: string }) {
  const [data, setData] = useState<CallsPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "success" | "failure">("all");

  useEffect(() => {
    setLoading(true);
    setError(null);
    getRunCalls(runId, page, 200)
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load calls"))
      .finally(() => setLoading(false));
  }, [runId, page]);

  if (loading) return <p className="muted">Loading call data…</p>;
  if (error) return <ErrorAlert error={error} />;
  if (!data || data.calls.length === 0) return <p className="muted">No call data available for this run yet.</p>;

  const filtered: CallRecord[] = filter === "all"
    ? data.calls
    : data.calls.filter((c) => (filter === "success" ? c.success : !c.success));

  const successCount = data.calls.filter((c) => c.success).length;
  const failCount = data.calls.length - successCount;

  return (
    <div className="calls-view">
      <div className="calls-toolbar">
        <div className="calls-summary">
          <span className="calls-stat calls-stat-ok">✓ {successCount} passed</span>
          {failCount > 0 && <span className="calls-stat calls-stat-fail">✗ {failCount} failed</span>}
          <span className="calls-stat-total">{data.total} total</span>
          {failCount > 0 && (
            <span className="muted" style={{ fontSize: "11px" }}>Click a failed row to see the full server response</span>
          )}
        </div>
        <div className="calls-filter">
          {(["all", "success", "failure"] as const).map((f) => (
            <button
              key={f}
              className={`small ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "success" ? "Passed" : "Failed"}
            </button>
          ))}
        </div>
      </div>

      <div className="calls-table-wrap">
        <table className="calls-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Label</th>
              <th>Code</th>
              <th>Duration</th>
              <th>Bytes</th>
              <th>Threads</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <CallRow key={c.index} call={c} />
            ))}
          </tbody>
        </table>
      </div>

      {data.totalPages > 1 && (
        <div className="calls-pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span className="muted">Page {data.page} of {data.totalPages}</span>
          <button className="small" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
