import { RunRecord } from "../types";

interface MetricRow {
  label: string;
  metric: string;
  aVal: number | null;
  bVal: number | null;
  lowerIsBetter: boolean;
  format?: (n: number) => string;
}

function buildRows(runA: RunRecord, runB: RunRecord): MetricRow[] {
  const labelsA = runA.jtlStats || [];
  const labelsB = runB.jtlStats || [];
  const allLabels = Array.from(new Set([...labelsA.map((s) => s.label), ...labelsB.map((s) => s.label)]));

  const rows: MetricRow[] = [];
  for (const label of allLabels) {
    const a = labelsA.find((s) => s.label === label);
    const b = labelsB.find((s) => s.label === label);
    rows.push({ label, metric: "Avg response time", aVal: a?.avgMs ?? null, bVal: b?.avgMs ?? null, lowerIsBetter: true, format: (n) => `${n} ms` });
    rows.push({ label, metric: "p95 response time", aVal: a?.p95Ms ?? null, bVal: b?.p95Ms ?? null, lowerIsBetter: true, format: (n) => `${n} ms` });
    rows.push({ label, metric: "Error rate", aVal: a?.errorPct ?? null, bVal: b?.errorPct ?? null, lowerIsBetter: true, format: (n) => `${n}%` });
    rows.push({ label, metric: "Throughput", aVal: a?.throughputPerSec ?? null, bVal: b?.throughputPerSec ?? null, lowerIsBetter: false, format: (n) => `${n}/s` });
  }
  return rows;
}

function DeltaCell({ row }: { row: MetricRow }) {
  if (row.aVal === null || row.bVal === null) return <span className="muted">—</span>;
  const diff = row.bVal - row.aVal;
  if (Math.abs(diff) < 0.001) return <span className="muted">no change</span>;
  const better = row.lowerIsBetter ? diff < 0 : diff > 0;
  const pct = row.aVal !== 0 ? Math.abs((diff / row.aVal) * 100) : 0;
  const arrow = diff > 0 ? "▲" : "▼";
  return (
    <span className={better ? "delta-good" : "delta-bad"}>
      {arrow} {pct.toFixed(1)}%
    </span>
  );
}

export default function RunCompareView({ runA, runB }: { runA: RunRecord; runB: RunRecord }) {
  const rows = buildRows(runA, runB);

  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="muted">Neither run has results to compare yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>
        Comparing: <span className="compare-name-a">{runA.testName}</span> vs{" "}
        <span className="compare-name-b">{runB.testName}</span>
      </h3>
      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Metric</th>
            <th>{runA.testName}</th>
            <th>{runB.testName}</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{row.label}</td>
              <td className="muted">{row.metric}</td>
              <td className="num-mono">{row.aVal !== null ? row.format?.(row.aVal) ?? row.aVal : "—"}</td>
              <td className="num-mono">{row.bVal !== null ? row.format?.(row.bVal) ?? row.bVal : "—"}</td>
              <td>
                <DeltaCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
