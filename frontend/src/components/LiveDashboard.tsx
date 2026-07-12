/**
 * LiveDashboard — real-time metrics during an active run.
 * Uses SSE (Server-Sent Events) to receive live JTL data from the server.
 * Replaces the log tail as the primary view while a test is running.
 */

import { useEffect, useRef, useState } from "react";
import { LabelStats } from "../types";

interface LiveMetrics {
  stats: LabelStats[];
  elapsed: number;
  totalSamples: number;
  totalErrors: number;
}

interface Props {
  runId: string;
  onComplete?: () => void;
}

export default function LiveDashboard({ runId, onComplete }: Props) {
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [status, setStatus] = useState<string>("connecting");
  const [log, setLog] = useState<string[]>([]);
  const [reconnects, setReconnects] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDone = useRef(false);

  function connect() {
    if (isDone.current) return;

    const es = new EventSource(`/api/runs/${runId}/stream`);
    esRef.current = es;

    es.addEventListener("metrics", (e) => {
      const data = JSON.parse(e.data);
      setMetrics(data);
      setStatus("running");
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      setStatus(data.status);
      if (data.logTail?.length) setLog(data.logTail);
    });

    es.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data);
      setStatus(data.status);
      isDone.current = true;
      es.close();
      onComplete?.();
    });

    // Auto-reconnect on error — don't show disconnected immediately
    es.onerror = () => {
      es.close();
      if (isDone.current) return;
      // Retry after 2 seconds — SSE drops are common on proxied connections
      reconnectTimer.current = setTimeout(() => {
        setReconnects(r => r + 1);
        connect();
      }, 2000);
    };
  }

  useEffect(() => {
    isDone.current = false;
    connect();
    return () => {
      isDone.current = true;
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [runId]);

  const elapsed = metrics?.elapsed || 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className="live-dashboard">
      <div className="live-dashboard-header">
        <div className="live-status-row">
          <span className="live-pulse" />
          <span className="live-label">Live</span>
          <span className="live-elapsed">{mins}:{String(secs).padStart(2, "0")}</span>
        </div>
        {metrics && (
          <div className="live-summary">
            <div className="live-stat">
              <div className="live-stat-val">{metrics.totalSamples}</div>
              <div className="live-stat-label">Requests</div>
            </div>
            <div className="live-stat">
              <div className={`live-stat-val ${metrics.totalErrors > 0 ? "live-stat-bad" : "live-stat-ok"}`}>
                {metrics.totalSamples > 0 ? ((metrics.totalErrors / metrics.totalSamples) * 100).toFixed(1) : "0.0"}%
              </div>
              <div className="live-stat-label">Error rate</div>
            </div>
            {metrics.stats[0] && (
              <>
                <div className="live-stat">
                  <div className="live-stat-val">{metrics.stats[0].avgMs}ms</div>
                  <div className="live-stat-label">Avg response</div>
                </div>
                <div className="live-stat">
                  <div className={`live-stat-val rating-${metrics.stats[0].performanceRating}`}>
                    {metrics.stats[0].p95Ms}ms
                  </div>
                  <div className="live-stat-label">p95</div>
                </div>
                <div className="live-stat">
                  <div className="live-stat-val">{metrics.stats[0].throughputPerSec.toFixed(2)}</div>
                  <div className="live-stat-label">Req/s</div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Live metrics table */}
      {metrics && metrics.stats.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table style={{ tableLayout: "auto", width: "100%" }}>
            <thead>
              <tr>
                <th>Label</th><th>Samples</th><th>Err%</th>
                <th>Avg</th><th>p90</th><th>p95</th><th>Req/s</th><th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {metrics.stats.map((s, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{s.label}</td>
                  <td className="num-mono">{s.samples}</td>
                  <td className={s.errorPct > 5 ? "num-bad" : "num-mono"}>{s.errorPct.toFixed(1)}%</td>
                  <td className="num-mono">{s.avgMs}ms</td>
                  <td className="num-mono">{s.p90Ms}ms</td>
                  <td className="num-mono">{s.p95Ms}ms</td>
                  <td className="num-mono">{s.throughputPerSec.toFixed(2)}</td>
                  <td><span className={`rating-badge rating-${s.performanceRating}`}>{s.performanceRating}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log tail */}
      {log.length > 0 && (
        <div className="live-log">
          {log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {!metrics && status === "connecting" && (
        <div className="muted" style={{ padding: "12px 0" }}>
          Connecting to live stream… JMeter is starting up.
        </div>
      )}

      {status === "error" && (
        <div className="muted" style={{ padding: "12px 0", fontSize: 12 }}>
          ↻ Reconnecting… ({reconnects} attempt{reconnects === 1 ? "" : "s"})
        </div>
      )}
    </div>
  );
}
