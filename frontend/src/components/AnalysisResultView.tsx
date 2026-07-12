import { Bottleneck, ErrorRating, LabelStats, PerformanceRating } from "../types";

function ratingBadgeClass(rating: PerformanceRating): string {
  if (rating === "excellent") return "rating-badge rating-excellent";
  if (rating === "good")      return "rating-badge rating-good";
  if (rating === "acceptable") return "rating-badge rating-acceptable";
  if (rating === "degraded")  return "rating-badge rating-degraded";
  return "rating-badge rating-poor";
}

function errorRatingClass(rating: ErrorRating): string {
  if (rating === "ok")       return "rating-badge rating-good";
  if (rating === "warning")  return "rating-badge rating-degraded";
  return "rating-badge rating-poor";
}

export default function AnalysisResultView({
  stats,
  analysis,
}: {
  stats: LabelStats[];
  analysis: { summary: string; bottlenecks: Bottleneck[]; recommendations: string[] };
}) {
  const hasErrors = stats.some((s) => s.errorBreakdown.length > 0);

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Samples</th>
              <th>Err %</th>
              <th>Min ms</th>
              <th>Avg ms</th>
              <th>Max ms</th>
              <th>p90</th>
              <th>p95</th>
              <th>p99</th>
              <th>Throughput/s</th>
              <th>Max threads</th>
              <th>Performance</th>
              <th>Error rate</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td>{s.samples}</td>
                <td className={s.errorPct > 0 ? "num-bad" : "num-mono"}>{s.errorPct}%</td>
                <td className="num-mono">{s.minMs}</td>
                <td className="num-mono">{s.avgMs}</td>
                <td className="num-mono">{s.maxMs}</td>
                <td className="num-mono">{s.p90Ms}</td>
                <td className="num-mono">{s.p95Ms}</td>
                <td className="num-mono">{s.p99Ms}</td>
                <td className="num-mono">{s.throughputPerSec}</td>
                <td className="num-mono">{s.maxThreads}</td>
                <td>
                  <span className={ratingBadgeClass(s.performanceRating)}>{s.performanceRating}</span>
                </td>
                <td>
                  <span className={errorRatingClass(s.errorRating)}>{s.errorRating}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Summary</h3>
        <p>{analysis.summary}</p>
      </div>

      {hasErrors && (
        <div className="card">
          <h3>Error breakdown</h3>
          {stats
            .filter((s) => s.errorBreakdown.length > 0)
            .map((s) => (
              <div key={s.label} className="error-breakdown-group">
                <strong>{s.label}</strong>
                <ul className="issue-list">
                  {s.errorBreakdown.map((e, i) => (
                    <li key={i} className="issue severity-high">
                      <span className="badge">{e.responseCode}</span>
                      <div>
                        <strong>
                          {e.count} {e.count === 1 ? "request" : "requests"}
                        </strong>
                        {e.sampleMessage && <p className="muted">{e.sampleMessage}</p>}
                        {e.sampleResponseBody && (
                          <div className="response-body-sample">
                            <span className="response-body-label">What the server actually said:</span>
                            <code>{e.sampleResponseBody}</code>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {analysis.bottlenecks.length > 0 && (
        <div className="card">
          <h3>Bottlenecks</h3>
          <ul className="issue-list">
            {analysis.bottlenecks.map((b, i) => (
              <li key={i} className={`issue severity-${b.severity}`}>
                <span className="badge">{b.severity}</span>
                <div>
                  <strong>{b.label}</strong>
                  <p>{b.observation}</p>
                  <p className="muted">Likely cause: {b.likelyCause}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>Recommendations</h3>
        <ul>
          {analysis.recommendations.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
