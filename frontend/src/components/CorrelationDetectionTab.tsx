import { useEffect, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import FieldGuide from "./FieldGuide";
import { detectCorrelations } from "../api";
import { CorrelationResponse } from "../types";
import type { SharedCorrelationData } from "../App";

const PLACEHOLDER = `Paste recorded requests and responses here, in order. Example:

[Step 1] POST /login
Response: { "sessionToken": "abc123", "userId": "9981" }

[Step 2] GET /cart
Headers sent: Authorization: Bearer abc123

[Step 3] POST /checkout
Body sent: { "userId": "9981", "items": [...] }

The AI will find that "abc123" appears in Step 1's response and gets reused in Step 2's header — and suggest a JMeter extractor to capture it automatically.`;

export default function CorrelationDetectionTab({
  sharedData,
  onClearShared,
}: {
  sharedData?: SharedCorrelationData | null;
  onClearShared?: () => void;
}) {
  const [transactions, setTransactions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CorrelationResponse | null>(null);
  const [fromShared, setFromShared] = useState(false);

  useEffect(() => {
    if (!sharedData) return;
    setTransactions(sharedData.prefill);
    setFromShared(true);
    setData(null);
    setError(null);
    if (onClearShared) onClearShared();
  }, [sharedData]);

  async function handleDetect() {
    if (!transactions.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await detectCorrelations(transactions);
      setData(result);
    } catch (e: any) {
      setError(e.message || "Correlation detection failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setTransactions("");
    setData(null);
    setError(null);
    setFromShared(false);
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Correlation Detection</h2>
        <p className="muted">
          When you record a multi-step test, some values from one response (like a login token)
          get reused in the next request. JMeter won't handle this automatically — you have to
          tell it to capture that value and pass it along. This tool finds those values for you.
        </p>
      </div>

      {/* What is correlation - educational block */}
      <div className="card correlation-explainer">
        <div className="correlation-explainer-grid">
          <div className="correlation-explainer-step">
            <div className="correlation-step-num">1</div>
            <div>
              <strong>Your login returns a token</strong>
              <p className="muted">e.g. <code>{`{ "sessionToken": "abc123" }`}</code></p>
            </div>
          </div>
          <div className="correlation-explainer-arrow">→</div>
          <div className="correlation-explainer-step">
            <div className="correlation-step-num">2</div>
            <div>
              <strong>Your next request sends it back</strong>
              <p className="muted">e.g. <code>Authorization: Bearer abc123</code></p>
            </div>
          </div>
          <div className="correlation-explainer-arrow">→</div>
          <div className="correlation-explainer-step">
            <div className="correlation-step-num">3</div>
            <div>
              <strong>AI generates the extractor</strong>
              <p className="muted">JMeter will capture it automatically during the test</p>
            </div>
          </div>
        </div>
      </div>

      {fromShared && (
        <div className="alert ok" style={{ marginBottom: 12, fontSize: 12 }}>
          ✓ Pre-filled from Build &amp; Run auto-detection. Edit below or{" "}
          <button className="link-btn" onClick={handleClear}>start fresh</button>.
        </div>
      )}

      <div className="form-grid" style={{ marginBottom: 8 }}>
        <label>
          <span className="label-text">
            Paste your recorded requests and responses{" "}
            <FieldGuide guide={{
              title: "What to paste here",
              icon: "📋",
              what: "Paste the requests and responses from your API session, in the order they happened. You can get these from your browser's DevTools (Network tab), Postman, or JMeter's Recording Controller. Include both what was sent AND what came back.",
              when: "Use this when you have a multi-step flow — like login first, then call an API. The login response gives you a token that the second request needs. You need correlation whenever a value from one response is used in the next request.",
              example: {
                context: "Login → AI chatbot flow",
                text: "Step 1 POST /login returns { sessionId: 'abc' }. Step 2 POST /query sends header x-session-id: abc. The AI will find this and suggest extracting sessionId from Step 1's response.",
              },
            }} />
          </span>
        </label>
      </div>

      <textarea
        rows={14}
        placeholder={PLACEHOLDER}
        value={transactions}
        onChange={(e) => setTransactions(e.target.value)}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />

      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={handleDetect} disabled={!transactions.trim() || loading}>
          {loading ? "Detecting…" : "Detect correlations"}
        </button>
        {transactions && (
          <button className="small" onClick={handleClear}>Clear</button>
        )}
      </div>

      {error && <ErrorAlert error={error} />}

      {data && (
        <div className="results">
          {data.correlations.length === 0 ? (
            <div className="card">
              <h3>No correlations found</h3>
              <p className="muted">
                No values appear to be reused between the requests and responses you provided.
                This is fine — it means each request is independent and doesn't need any values from previous responses.
              </p>
              <p className="muted">
                If you expected correlations, check that you included both the response bodies
                (what the server sent back) and the subsequent requests (what was sent next).
              </p>
            </div>
          ) : (
            <>
              <div className="card">
                <h3>Found {data.correlations.length} correlation{data.correlations.length === 1 ? "" : "s"}</h3>
                <p className="muted" style={{ marginBottom: 12 }}>
                  Each row below is a value that needs to be captured from one response and replayed in a later request.
                  Copy the expression into LoadPilot's "Save a value" field in that step.
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>
                          Variable name{" "}
                          <FieldGuide guide={{
                            title: "Variable name",
                            icon: "🏷️",
                            what: "The name LoadPilot will use to store this value so later steps can reference it. Use it as ${variableName} in headers or body of the step that needs it.",
                            example: { context: "Session token", text: "Variable name 'sessionToken' → use as ${sessionToken} in Authorization header of the next step." },
                          }} />
                        </th>
                        <th>Found in</th>
                        <th>
                          Extractor type{" "}
                          <FieldGuide guide={{
                            title: "Extractor type",
                            icon: "🔧",
                            what: "JSON Extractor picks values out of JSON responses using a path like $.token. Regular Expression Extractor uses a search pattern for non-JSON responses. JSON Extractor is preferred when the response is JSON.",
                            example: { context: "JSON response", text: "Response is {token: 'abc'} → JSON Extractor with path $.token. Much easier than writing a regex." },
                          }} />
                        </th>
                        <th>Expression to use</th>
                        <th>Used in</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.correlations.map((c, i) => (
                        <tr key={i}>
                          <td className="num-mono">{c.variableName}</td>
                          <td>{c.foundIn}</td>
                          <td>{c.extractorType}</td>
                          <td className="num-mono">{c.expression}</td>
                          <td>
                            {c.usedIn}
                            <div className="muted" style={{ fontSize: 11 }}>{c.usedInField}</div>
                          </td>
                          <td>
                            <button className="small" onClick={() => copy(c.expression)}>
                              Copy
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h3>How to use these in LoadPilot</h3>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
                  <li>Go to <strong>Build &amp; Run</strong> → find the step that returns the value</li>
                  <li>In that step's <strong>"Save a value from this response"</strong> section, set the variable name and paste the expression</li>
                  <li>In the step that <em>uses</em> the value, add a header or body field containing <code>${"{variableName}"}</code></li>
                </ol>
              </div>
            </>
          )}

          {data.notes && (
            <div className="card">
              <h3>Notes from the AI</h3>
              <p>{data.notes}</p>
            </div>
          )}

          <p className="usage-footer">
            {data.model} · {data.usage.promptTokens + data.usage.completionTokens} tokens · ~${data.cost.toFixed(5)}
          </p>
        </div>
      )}
    </div>
  );
}
