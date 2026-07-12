import { useEffect, useState } from "react";
import { parseSampleProgress } from "../sampleProgress";
import { RunRecord } from "../types";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function ProgressTracker({ run }: { run: RunRecord }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (run.status !== "running") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [run.status]);

  if (run.status !== "running" || !run.startedAt) return null;

  const progress = parseSampleProgress(run.logTail);

  // For loop-count-based tests, the "duration" is the loop count — use sample
  // count as the primary progress signal. For time-based tests, use elapsed time.
  const loopCount = run.config.load.loopCount;
  const totalPlannedSeconds = run.config.load.durationSeconds;
  const elapsedSeconds = Math.max(0, (now - new Date(run.startedAt).getTime()) / 1000);
  const users = run.config.load.users ?? 1;

  let percent: number;
  let statusLine: string;

  if (loopCount && loopCount > 0) {
    // Loop-based: estimate from samples completed vs expected (users × loops)
    const expectedTotal = users * loopCount;
    percent = Math.min(100, (progress.totalSamples / expectedTotal) * 100);
    statusLine = `${progress.totalSamples} of ~${expectedTotal} requests (${Math.round(percent)}%)`;
  } else {
    percent = Math.min(100, (elapsedSeconds / totalPlannedSeconds) * 100);
    statusLine = `${formatDuration(elapsedSeconds)} of ${formatDuration(totalPlannedSeconds)} planned (${Math.round(percent)}%)`;
  }

  // Detect if the test seems to have finished early (summarizer showed final line)
  const likelyDone = progress.finished;
  const displayPercent = likelyDone ? 100 : percent;

  return (
    <div className="card progress-tracker">
      <h3>Progress {likelyDone && <span className="muted small-text">— finishing up…</span>}</h3>
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${displayPercent}%`, background: likelyDone ? "var(--accent-teal)" : undefined }}
        />
      </div>
      <div className="progress-stats">
        <span>{likelyDone ? "All requests completed — processing results…" : statusLine}</span>
        {!likelyDone && progress.totalSamples > 0 && <span>{progress.totalSamples} requests done</span>}
        {!likelyDone && progress.activeThreads != null && <span>{progress.activeThreads} active users</span>}
      </div>
      <p className="muted small-text">
        {loopCount ? "Progress based on completed requests vs expected total." : "Based on elapsed time and JMeter's log output — updates every ~2 seconds."}
      </p>
    </div>
  );
}
