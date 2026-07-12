import { useEffect, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import FieldGuide from "./FieldGuide";
import { reviewScript } from "../api";
import { ScriptReviewResponse } from "../types";
import ReviewResultView from "./ReviewResultView";
import type { SharedJmxData } from "../App";

export default function ScriptReviewTab({
  sharedJmx,
  onClearShared,
}: {
  sharedJmx?: SharedJmxData | null;
  onClearShared?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScriptReviewResponse | null>(null);
  const [fromShared, setFromShared] = useState(false);
  const [autoReviewed, setAutoReviewed] = useState(false);

  // Auto-review when a JMX is pushed from Build & Run
  useEffect(() => {
    if (!sharedJmx) return;
    setFile(sharedJmx.file);
    setFromShared(true);
    setData(null);
    setError(null);
    if (onClearShared) onClearShared();
    // Auto-run the review
    runReview(sharedJmx.file);
  }, [sharedJmx]);

  async function runReview(f: File) {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await reviewScript(f);
      setData(result);
      setAutoReviewed(true);
    } catch (e: any) {
      setError(e.message || "Script review failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview() {
    if (!file) return;
    await runReview(file);
  }

  function handleClear() {
    setFile(null);
    setData(null);
    setError(null);
    setFromShared(false);
    setAutoReviewed(false);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Script Review</h2>
        <p className="muted">
          Checks your JMeter test plan for common mistakes before you run it — like missing
          timing controls, enabled debug listeners, or configuration that would give misleading results.
          Think of it as a spell-checker for your test script.
        </p>
      </div>

      {/* Educational explainer */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>
          What does a script review check?{" "}
          <FieldGuide guide={{
            title: "What Script Review checks",
            icon: "🔍",
            what: "Script Review reads your JMeter .jmx file and checks for patterns that often cause problems: no think time between requests (makes the test unrealistically aggressive), debug listeners left enabled (slows down and can crash the test), thread group settings that don't match your intentions, and missing assertions.",
            when: "Always review before sharing a test plan with colleagues or before running a serious load test. It takes 5 seconds and can save hours of debugging incorrect results.",
            example: { context: "Common catch", text: "A 'View Results Tree' listener left enabled from recording — it captures every request/response in memory and will eventually crash JMeter under heavy load. Script Review flags it and tells you to disable it for load testing." },
          }} />
        </h3>
        <div className="review-checks-grid">
          {[
            { icon: "⏱️", label: "Timers", desc: "Are pauses between requests configured?" },
            { icon: "👥", label: "Thread groups", desc: "Do user counts and ramp-up make sense?" },
            { icon: "🎧", label: "Listeners", desc: "Are debug listeners disabled for load tests?" },
            { icon: "✅", label: "Assertions", desc: "Is there at least one pass/fail check?" },
            { icon: "📁", label: "Data sets", desc: "Is test data configured correctly?" },
            { icon: "🔗", label: "Extractors", desc: "Are dynamic values captured properly?" },
          ].map((c, i) => (
            <div key={i} className="review-check-item">
              <span className="review-check-icon">{c.icon}</span>
              <div>
                <div className="review-check-label">{c.label}</div>
                <div className="review-check-desc muted">{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {fromShared && (
        <div className="alert ok" style={{ marginBottom: 12, fontSize: 12 }}>
          ✓ {autoReviewed ? "Auto-reviewed the script generated in Build & Run." : "Script loaded from Build & Run."}{" "}
          <button className="link-btn" onClick={handleClear}>Review a different file instead</button>
        </div>
      )}

      {!fromShared && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>
            Upload a .jmx file{" "}
            <FieldGuide guide={{
              title: "Where to get a .jmx file",
              icon: "📂",
              what: "A .jmx file is the JMeter test plan file. You get one from: LoadPilot's Generate button (in Build & Run), JMeter's File → Save menu after building a test plan manually, or a colleague who shared their test plan with you.",
              when: "Upload here when reviewing a test plan you received from someone else, or when reviewing a plan you built directly in JMeter rather than through LoadPilot.",
              example: { context: "Most common case", text: "Your teammate sends you a test_plan.jmx. Upload it here to check it for issues before running it." },
            }} />
          </h3>
          <div className="row">
            <input
              type="file"
              accept=".jmx,.xml"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                setData(null);
                setError(null);
                setAutoReviewed(false);
              }}
            />
            <button onClick={handleReview} disabled={!file || loading}>
              {loading ? "Reviewing…" : "Review script"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="card">
          <p className="muted">Reading your script and checking for issues…</p>
        </div>
      )}

      {error && <ErrorAlert error={error} />}

      {data && (
        <div className="results">
          <ReviewResultView facts={data.facts} review={data.review} />
          <p className="usage-footer">
            {data.model} · {data.usage.promptTokens + data.usage.completionTokens} tokens · ~${data.cost.toFixed(5)}
          </p>
        </div>
      )}
    </div>
  );
}
