import { useEffect, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import { analyzeResults, getRun } from "../api";
import { ResultsAnalysisResponse } from "../types";
import AnalysisResultView from "./AnalysisResultView";
import FieldGuide from "./FieldGuide";

export default function ResultsAnalysisTab({
  sharedRunId,
  onClearShared,
}: {
  sharedRunId?: string | null;
  onClearShared?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResultsAnalysisResponse | null>(null);
  const [goodMs, setGoodMs] = useState("");
  const [moderateMs, setModerateMs] = useState("");

  // Auto-load from Run Report when navigated there
  useEffect(() => {
    if (!sharedRunId) return;
    getRun(sharedRunId).then(run => {
      if (run?.jtlStats && run.analysis) {
        setData({ stats: run.jtlStats, analysis: run.analysis, usage: run.usage || { promptTokens: 0, completionTokens: 0 }, cost: run.cost || 0, model: (run as any).model || "" });
        if (onClearShared) onClearShared();
      }
    }).catch(() => {});
  }, [sharedRunId]);

  async function handleAnalyze() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const thresholds =
        goodMs && moderateMs && Number(goodMs) > 0 && Number(moderateMs) > Number(goodMs)
          ? { goodMs: Number(goodMs), moderateMs: Number(moderateMs) }
          : undefined;
      const result = await analyzeResults(file, thresholds);
      setData(result);
    } catch (e: any) {
      setError(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Results Analysis</h2>
        <p className="muted">
          Upload a JMeter <code>.jtl</code> file (CSV format). Stats are computed in code; the LLM
          only interprets them — it never sees or invents raw numbers.
        </p>
      </div>

      <div className="row">
        <input
          type="file"
          accept=".jtl,.csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <button onClick={handleAnalyze} disabled={!file || loading}>
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      <div className="card">
        <h3>Performance thresholds (optional)</h3>
        <p className="muted">
          Define what counts as "good," "moderate," or "poor" for this data. Leave both blank to
          use a general-purpose default (500ms / 2000ms) — not an authoritative standard, just a
          reasonable starting point.
        </p>
        <div className="form-grid">
          <label>
            <span className="label-text">
              "Good" up to (ms) <FieldGuide guide={{
                title: "Good response time",
                icon: "✅",
                what: "p95 response time at or below this is rated as good performance — meaning 95% of requests finished this fast or faster.",
                example: { context: "AI chatbot", text: "8000ms — if 95% of requests finish within 8 seconds, we consider performance good for this endpoint." },
              }} />
            </span>
            <input value={goodMs} placeholder="e.g. 500" onChange={(e) => setGoodMs(e.target.value)} />
          </label>
          <label>
            <span className="label-text">
              "Moderate" up to (ms) <FieldGuide guide={{
                title: "Moderate response time",
                icon: "🟡",
                what: "p95 response time above 'Good' but at or below this is rated moderate — usable but noticeably slow. Anything above this counts as poor.",
                example: { context: "AI chatbot", text: "20000ms — responses between 8 and 20 seconds are acceptable but slow. Above 20 seconds is poor." },
              }} />
            </span>
            <input value={moderateMs} placeholder="e.g. 2000" onChange={(e) => setModerateMs(e.target.value)} />
          </label>
        </div>
      </div>

      {error && <ErrorAlert error={error} />}

      {data && (
        <div className="results">
          <AnalysisResultView stats={data.stats} analysis={data.analysis} />

          <p className="usage-footer">
            {data.model} · {data.usage.promptTokens + data.usage.completionTokens} tokens · ~$
            {data.cost.toFixed(5)}
          </p>
        </div>
      )}
    </div>
  );
}
