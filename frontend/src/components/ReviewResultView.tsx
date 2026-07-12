import { JmxFacts, ScriptIssue } from "../types";

const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default function ReviewResultView({
  facts,
  review,
}: {
  facts: JmxFacts;
  review: { issues: ScriptIssue[]; summary: string };
}) {
  return (
    <>
      <div className="card">
        <h3>Plan overview</h3>
        <div className="stat-grid">
          <div>
            <span className="stat-num">{facts.threadGroups.length}</span>
            <span className="muted">Thread groups</span>
          </div>
          <div>
            <span className="stat-num">{facts.samplers.length}</span>
            <span className="muted">Samplers</span>
          </div>
          <div>
            <span className="stat-num">{facts.timers}</span>
            <span className="muted">Timers</span>
          </div>
          <div>
            <span className="stat-num">{facts.csvDataSets}</span>
            <span className="muted">CSV Data Sets</span>
          </div>
        </div>
        {facts.threadGroups.map((tg, i) => (
          <p key={i} className="muted">
            {tg.name}: {tg.numThreads} users, {tg.rampTime}s ramp-up, {tg.loops} loop(s)
          </p>
        ))}
        {facts.listeners.filter((l) => l.enabled).length > 0 && (
          <p className="muted">
            Enabled listeners: {facts.listeners.filter((l) => l.enabled).map((l) => l.name).join(", ")}
          </p>
        )}
      </div>

      <div className="card">
        <h3>Summary</h3>
        <p>{review.summary}</p>
      </div>

      <div className="card">
        <h3>Issues</h3>
        {review.issues.length === 0 ? (
          <p className="muted">No issues found.</p>
        ) : (
          <ul className="issue-list">
            {[...review.issues]
              .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
              .map((issue, i) => (
                <li key={i} className={`issue severity-${issue.severity}`}>
                  <span className="badge">{issue.severity}</span>
                  <div>
                    <strong>{issue.scope}</strong>
                    <p>{issue.issue}</p>
                    <p className="muted">Fix: {issue.recommendation}</p>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </>
  );
}
