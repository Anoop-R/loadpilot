import { useEffect, useState } from "react";
import ErrorAlert from "./ErrorAlert";
import { generateTestData } from "../api";
import { TestDataField, TestDataResponse } from "../types";

let idCounter = 0;
function nextId() { idCounter += 1; return idCounter; }

interface FieldRow extends TestDataField { id: number; }

export default function TestDataGeneratorTab({
  sharedVars,
  onClearShared,
}: {
  sharedVars?: string[];
  onClearShared?: () => void;
}) {
  const [fields, setFields] = useState<FieldRow[]>([
    { id: nextId(), name: "userId", type: "number", description: "unique, 10000-99999" },
    { id: nextId(), name: "email", type: "string", description: "realistic email address" },
    { id: nextId(), name: "orderAmount", type: "number", description: "10.00-500.00, two decimals" },
  ]);

  // Auto-populate fields from config variables
  useEffect(() => {
    if (!sharedVars || sharedVars.length === 0) return;

    function guessDescription(name: string): { type: string; description: string } {
      const n = name.toLowerCase();
      if (n.includes("userid") || n.includes("user_id"))   return { type: "number", description: "unique user ID, range 1001-9999" };
      if (n.includes("sessionid") || n.includes("session")) return { type: "string", description: "session token, format: sess_XXXXXXXX (8 random alphanumeric chars)" };
      if (n.includes("email"))                              return { type: "string", description: "realistic email address" };
      if (n.includes("name"))                               return { type: "string", description: "realistic full name" };
      if (n.includes("phone"))                              return { type: "string", description: "10-digit phone number" };
      if (n.includes("query") || n.includes("search"))     return { type: "string", description: "realistic search query, 3-8 words" };
      if (n.includes("amount") || n.includes("price"))     return { type: "number", description: "decimal amount, range 10.00-500.00" };
      if (n.includes("id"))                                 return { type: "number", description: "unique numeric ID, range 1001-9999" };
      if (n.includes("token") || n.includes("key"))        return { type: "string", description: "32-character alphanumeric token" };
      if (n.includes("date") || n.includes("time"))        return { type: "date",   description: "ISO date format YYYY-MM-DD" };
      if (n.includes("count") || n.includes("num"))        return { type: "number", description: "integer, range 1-100" };
      if (n.includes("code") || n.includes("status"))      return { type: "string", description: "short alphanumeric code, 4-8 chars" };
      if (n.includes("url") || n.includes("link"))         return { type: "string", description: "valid HTTPS URL" };
      if (n.includes("payload") || n.includes("body"))     return { type: "string", description: "JSON payload string" };
      return { type: "string", description: `realistic ${name} value` };
    }

    setFields(sharedVars.map(v => {
      const { type, description } = guessDescription(v);
      return { id: nextId(), name: v, type, description };
    }));
    if (onClearShared) onClearShared();
  }, [sharedVars]);
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TestDataResponse | null>(null);

  // Sample learning
  const [showSample, setShowSample] = useState(false);
  const [sampleRequest, setSampleRequest] = useState("");
  const [sampleResponse, setSampleResponse] = useState("");
  const [sampleNotes, setSampleNotes] = useState("");

  function updateField(id: number, patch: Partial<TestDataField>) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  function addField() {
    setFields(prev => [...prev, { id: nextId(), name: "", type: "string", description: "" }]);
  }

  function removeField(id: number) {
    setFields(prev => prev.filter(f => f.id !== id));
  }

  async function handleGenerate() {
    const cleanFields = fields.filter(f => f.name.trim());
    if (cleanFields.length === 0 || count <= 0) return;
    setLoading(true);
    setError(null);
    setData(null);

    const sample = (sampleRequest.trim() || sampleResponse.trim() || sampleNotes.trim())
      ? { requestBody: sampleRequest.trim() || undefined, responseBody: sampleResponse.trim() || undefined, notes: sampleNotes.trim() || undefined }
      : undefined;

    try {
      const result = await generateTestData(
        cleanFields.map(({ name, type, description }) => ({ name, type, description })),
        count,
        sample
      );
      setData(result);
    } catch (e: any) {
      setError(e.message || "Test data generation failed.");
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!data) return;
    const blob = new Blob([data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "test-data.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Test Data Generator</h2>
        <p className="muted">
          Describe the fields you need and the AI generates realistic, varied test data as a CSV
          ready for JMeter. For best results, paste a real API request and response so the AI
          generates data that your API will actually accept.
        </p>
      </div>

      {/* Sample learning section */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="sample-learn-header"
          onClick={() => setShowSample(v => !v)}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <div>
            <strong>🧠 Teach the AI your API's patterns (recommended)</strong>
            <p className="muted small-text" style={{ margin: "3px 0 0" }}>
              Paste a real request and response — the AI will generate data that matches your actual API's formats, not generic placeholders.
            </p>
          </div>
          <span className="muted">{showSample ? "▲ Hide" : "▼ Show"}</span>
        </div>

        {showSample && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              <span className="label-text">Real request body (paste a working example)</span>
              <textarea
                rows={5}
                value={sampleRequest}
                placeholder={`e.g.\n{\n  "user_id": "user_001",\n  "session_id": "sess_abc123",\n  "query": "how many assets are present?"\n}`}
                onChange={e => setSampleRequest(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>
            <label>
              <span className="label-text">Real response body from that request (optional)</span>
              <textarea
                rows={4}
                value={sampleResponse}
                placeholder={`e.g.\n{\n  "answer": "There are 47 assets currently active.",\n  "status": "ok"\n}`}
                onChange={e => setSampleResponse(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>
            <label>
              <span className="label-text">Anything else the AI should know (optional)</span>
              <input
                value={sampleNotes}
                placeholder="e.g. user_id follows the pattern 'user_NNN', session IDs are always 12 chars"
                onChange={e => setSampleNotes(e.target.value)}
              />
            </label>
            {(sampleRequest || sampleResponse) && (
              <div className="alert ok" style={{ fontSize: 12 }}>
                ✓ The AI will analyse your sample and generate data that matches these exact patterns.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fields table */}
      <table className="field-table">
        <thead>
          <tr>
            <th>Field name</th>
            <th>Type</th>
            <th>Description / constraints</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {fields.map(f => (
            <tr key={f.id}>
              <td>
                <input value={f.name} placeholder="fieldName"
                  onChange={e => updateField(f.id, { name: e.target.value })} />
              </td>
              <td>
                <select value={f.type} onChange={e => updateField(f.id, { type: e.target.value })}>
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="date">date</option>
                  <option value="enum">enum</option>
                </select>
              </td>
              <td>
                <input value={f.description} placeholder="e.g. 10-digit phone number"
                  onChange={e => updateField(f.id, { description: e.target.value })} />
              </td>
              <td>
                <button className="small" onClick={() => removeField(f.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row">
        <button className="small" onClick={addField}>+ Add field</button>
      </div>

      <div className="row" style={{ alignItems: "center" }}>
        <span className="inline-label">Rows:</span>
        <input
          type="number" min={1} max={1000} value={count}
          style={{ width: "80px" }}
          onChange={e => setCount(Number(e.target.value))}
        />
        <button onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating…" : (sampleRequest || sampleResponse) ? "Generate (with sample learning)" : "Generate"}
        </button>
      </div>

      {error && <ErrorAlert error={error} />}

      {data && (
        <div className="results">
          {data.cappedAt && (
            <div className="alert warn">Requested {data.requested} rows, capped at {data.cappedAt}.</div>
          )}
          {(data as any).learnedFromSample && (
            <div className="alert ok" style={{ fontSize: 12, marginBottom: 8 }}>
              ✓ Generated using your API sample — data patterns match your real request format.
            </div>
          )}
          <div className="row">
            <span className="muted">{data.generated} rows generated.</span>
            <button className="small" onClick={downloadCsv}>Download CSV</button>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>{fields.filter(f => f.name).map(f => <th key={f.id}>{f.name}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    {fields.filter(f => f.name).map(f => (
                      <td key={f.id} className="num-mono">{String(row[f.name] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length > 20 && (
            <p className="muted">Showing first 20 of {data.rows.length} rows. Download CSV for all.</p>
          )}
          <p className="usage-footer">
            {data.model} · {data.usage.promptTokens + data.usage.completionTokens} tokens · ~${data.cost.toFixed(5)}
          </p>
        </div>
      )}
    </div>
  );
}

