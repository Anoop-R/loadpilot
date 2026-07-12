/**
 * ProbeRequest — "Try it first" single request tester.
 * Fires one real HTTP request from the server and shows the response
 * before committing to a full load test. Catches config errors in seconds.
 */

import { useState } from "react";
import { sendProbe, ProbeResult } from "../api";
import ErrorAlert from "./ErrorAlert";

interface ProbeProps {
  protocol: string;
  domain: string;
  port?: number;
  path: string;
  method: string;
  headers: { name: string; value: string }[];
  body?: string;
}

export default function ProbeRequest({ protocol, domain, port, path, method, headers, body }: ProbeProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleProbe() {
    setLoading(true);
    setResult(null);
    try {
      const res = await sendProbe({ protocol, domain, port, path, method, headers, body });
      setResult(res);
      setExpanded(true);
    } catch (e: any) {
      setResult({ ok: false, error: e.message });
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  }

  const statusOk = result?.status && result.status >= 200 && result.status < 300;

  return (
    <div className="probe-section">
      <div className="probe-header">
        <div>
          <strong>Try it first</strong>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
            Send one real request before running the full test
          </span>
        </div>
        <button
          className="small probe-btn"
          onClick={handleProbe}
          disabled={loading || !domain}
          title="Send a single request to verify your config is correct"
        >
          {loading ? "Sending…" : "⚡ Send one request"}
        </button>
      </div>

      {result && expanded && (
        <div className={`probe-result ${statusOk ? "probe-result--ok" : "probe-result--error"}`}>
          <div className="probe-result-header">
            <div className="probe-status">
              <span className={`probe-status-code ${statusOk ? "ok" : "bad"}`}>
                {result.status || "ERR"}
              </span>
              <span className="muted">{result.statusText}</span>
              {result.durationMs && (
                <span className="probe-duration">{result.durationMs}ms</span>
              )}
              <span className="muted" style={{ fontSize: 11 }}>{result.url}</span>
            </div>
            <button className="small" onClick={() => setExpanded(false)}>Dismiss</button>
          </div>

          {result.error && (
            <ErrorAlert error={result.error} />
          )}

          {result.body && (
            <div className="probe-body-wrap">
              <div className="probe-body-label">Response body</div>
              <pre className="probe-body">
                {(() => {
                  try { return JSON.stringify(JSON.parse(result.body!), null, 2); }
                  catch { return result.body; }
                })()}
              </pre>
            </div>
          )}

          {!statusOk && result.status && (
            <div className="probe-advice">
              {result.status === 400 && "400: The server rejected the request — check the body format and required headers."}
              {result.status === 401 && "401: Authentication failed — check your API key or auth token."}
              {result.status === 403 && "403: Access denied — check permissions."}
              {result.status === 404 && "404: Endpoint not found — check the URL path."}
              {result.status === 429 && "429: Rate limited — try again in a moment."}
              {result.status === 500 && "500: Server error — check the server-side logs."}
              {result.status === 502 && "502: Bad gateway — server may be down or overloaded."}
            </div>
          )}

          {statusOk && (
            <div className="probe-advice probe-advice--ok">
              ✓ Request succeeded — your config looks correct. Safe to run the load test.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
