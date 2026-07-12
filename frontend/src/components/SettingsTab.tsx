import { useEffect, useState } from "react";
import { getAppSettings, updateAppSettings, AppSettings } from "../api";
import ErrorAlert from "./ErrorAlert";
import { useToast } from "./Toast";

const CICD_GITHUB = [
  "name: Load Test",
  "on:",
  "  push:",
  "    branches: [main]",
  "  workflow_dispatch:",
  "",
  "jobs:",
  "  load-test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Trigger LoadPilot run",
  "        id: trigger",
  "        run: |",
  "          RESPONSE=$(curl -s -X POST http://YOUR_SERVER:4000/api/runs/trigger \\",
  "            -H \"Content-Type: application/json\" \\",
  "            -d '{\"savedConfigId\": \"YOUR_CONFIG_ID\", \"waitForCompletion\": true}')",
  "          echo \"response=$RESPONSE\" >> $GITHUB_OUTPUT",
  "          STATUS=$(echo $RESPONSE | jq -r '.status')",
  "          if [ \"$STATUS\" != \"completed\" ]; then",
  "            echo \"Load test failed: $STATUS\"",
  "            exit 1",
  "          fi",
  "",
  "      - name: Download report",
  "        run: |",
  "          RUN_ID=$(echo '${{ steps.trigger.outputs.response }}' | jq -r '.runId')",
  "          curl -o report.html \"http://YOUR_SERVER:4000/api/runs/$RUN_ID/report.html?mode=external\"",
  "",
  "      - name: Upload report",
  "        uses: actions/upload-artifact@v4",
  "        with:",
  "          name: load-test-report",
  "          path: report.html",
].join("\n");

const CICD_GITLAB = `load-test:
  stage: test
  script:
    - |
      RESPONSE=$(curl -s -X POST http://YOUR_SERVER:4000/api/runs/trigger \\
        -H "Content-Type: application/json" \\
        -d '{"savedConfigId": "YOUR_CONFIG_ID", "waitForCompletion": true}')
      STATUS=$(echo $RESPONSE | jq -r '.status')
      RUN_ID=$(echo $RESPONSE | jq -r '.runId')
      curl -o load-test-report.html "http://YOUR_SERVER:4000/api/runs/$RUN_ID/report.html?mode=external"
      [ "$STATUS" = "completed" ] || exit 1
  artifacts:
    paths:
      - load-test-report.html
    expire_in: 30 days`;

const CICD_JENKINS = `pipeline {
  agent any
  stages {
    stage('Load Test') {
      steps {
        script {
          def response = sh(
            script: """curl -s -X POST http://YOUR_SERVER:4000/api/runs/trigger \\
              -H "Content-Type: application/json" \\
              -d '{"savedConfigId": "YOUR_CONFIG_ID", "waitForCompletion": true}'""",
            returnStdout: true
          ).trim()
          def json = readJSON text: response
          if (json.status != 'completed') error("Load test failed: \${json.status}")
          sh "curl -o load-test-report.html http://YOUR_SERVER:4000/api/runs/\${json.runId}/report.html?mode=external"
        }
      }
      post { always { archiveArtifacts 'load-test-report.html' } }
    }
  }
}`;

export default function SettingsTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [cicdTab, setCicdTab] = useState<"github" | "gitlab" | "jenkins">("github");
  const { toast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const s = await getAppSettings();
      setSettings(s);
    } catch (e: any) { setError(e.message); }
  }

  async function save(patch: Partial<AppSettings>) {
    setSaving(true);
    try {
      const updated = await updateAppSettings(patch);
      setSettings(updated);
      toast.success("Settings saved.");
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  function addAgent() {
    const ip = agentInput.trim();
    if (!ip || !settings) return;
    const agents = [...settings.remoteAgents.filter(a => a !== ip), ip];
    save({ remoteAgents: agents });
    setAgentInput("");
  }

  function removeAgent(ip: string) {
    if (!settings) return;
    save({ remoteAgents: settings.remoteAgents.filter(a => a !== ip) });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text);
    toast.success("Copied to clipboard.");
  }

  if (!settings) return <div className="panel"><p className="muted">Loading settings…</p></div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Settings</h2>
        <p className="muted">App configuration, distributed agents, and CI/CD integration.</p>
      </div>

      {error && <ErrorAlert error={error} />}

      {/* Distributed JMeter agents */}
      <div className="card">
        <h3>Distributed testing — Remote JMeter agents</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Add IP addresses of machines running JMeter in server mode (<code>jmeter-server</code>).
          When agents are configured, LoadPilot distributes load across all of them automatically —
          multiplying your total user capacity by the number of agents.
        </p>
        <div className="card" style={{ background: "rgba(79,182,168,0.05)", marginBottom: 12 }}>
          <strong>To start a JMeter agent on another machine:</strong>
          <pre style={{ margin: "8px 0 0", fontSize: 12, fontFamily: "monospace" }}>
{`# On the agent machine (must have JMeter installed):
cd C:\\apache-jmeter-5.6.3\\bin
jmeter-server.bat     # Windows
./jmeter-server        # Linux/Mac

# The agent listens on port 1099 by default.
# Make sure port 1099 is open between machines.`}
          </pre>
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <input
            value={agentInput}
            placeholder="192.168.1.x"
            onChange={e => setAgentInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addAgent()}
            style={{ fontFamily: "monospace", maxWidth: 200 }}
          />
          <button className="small" onClick={addAgent} disabled={!agentInput.trim() || saving}>
            Add agent
          </button>
        </div>

        {settings.remoteAgents.length === 0 ? (
          <p className="muted">No remote agents — tests run on this machine only.</p>
        ) : (
          <div className="agents-list">
            {settings.remoteAgents.map(ip => (
              <div key={ip} className="agent-row">
                <span className="agent-dot">●</span>
                <span className="num-mono">{ip}</span>
                <button className="small danger-btn" onClick={() => removeAgent(ip)}>Remove</button>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {settings.remoteAgents.length} agent{settings.remoteAgents.length === 1 ? "" : "s"} — estimated capacity multiplier: {settings.remoteAgents.length + 1}×
            </p>
          </div>
        )}
      </div>

      {/* Performance thresholds */}
      <div className="card">
        <h3>Default performance thresholds</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Applied to new tests when no custom thresholds are set.
        </p>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label>
            <span className="label-text">Good response time (p95, ms)</span>
            <input
              type="number"
              value={settings.defaultGoodMs}
              onChange={e => setSettings(s => s ? { ...s, defaultGoodMs: Number(e.target.value) } : s)}
              onBlur={() => save({ defaultGoodMs: settings.defaultGoodMs })}
            />
          </label>
          <label>
            <span className="label-text">Acceptable response time (p95, ms)</span>
            <input
              type="number"
              value={settings.defaultAcceptableMs}
              onChange={e => setSettings(s => s ? { ...s, defaultAcceptableMs: Number(e.target.value) } : s)}
              onBlur={() => save({ defaultAcceptableMs: settings.defaultAcceptableMs })}
            />
          </label>
        </div>
      </div>

      {/* CI/CD integration */}
      <div className="card">
        <h3>CI/CD integration</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Copy the template for your CI/CD platform. Replace <code>YOUR_SERVER</code> with this machine's IP
          and <code>YOUR_CONFIG_ID</code> with a saved config ID from Build &amp; Run → Saved configs.
        </p>

        <div className="smart-builder-tabs" style={{ marginBottom: 14 }}>
          {(["github", "gitlab", "jenkins"] as const).map(t => (
            <button
              key={t}
              className={`smart-builder-tab ${cicdTab === t ? "active" : ""}`}
              onClick={() => setCicdTab(t)}
            >
              {t === "github" ? "GitHub Actions" : t === "gitlab" ? "GitLab CI" : "Jenkins"}
            </button>
          ))}
        </div>

        <div style={{ position: "relative" }}>
          <pre className="cicd-template">
            {cicdTab === "github" ? CICD_GITHUB : cicdTab === "gitlab" ? CICD_GITLAB : CICD_JENKINS}
          </pre>
          <button
            className="small cicd-copy-btn"
            onClick={() => copyToClipboard(cicdTab === "github" ? CICD_GITHUB : cicdTab === "gitlab" ? CICD_GITLAB : CICD_JENKINS)}
          >
            Copy
          </button>
        </div>

        <div className="card" style={{ marginTop: 12, background: "rgba(79,182,168,0.05)" }}>
          <strong>API endpoint reference</strong>
          <table className="mini-table" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td style={{ color: "var(--text-muted)", width: 200 }}>Trigger a run</td><td className="num-mono">POST /api/runs/trigger</td></tr>
              <tr><td style={{ color: "var(--text-muted)" }}>Get run status</td><td className="num-mono">GET /api/runs/:id</td></tr>
              <tr><td style={{ color: "var(--text-muted)" }}>Download report</td><td className="num-mono">GET /api/runs/:id/report.html?mode=external</td></tr>
              <tr><td style={{ color: "var(--text-muted)" }}>Download JTL</td><td className="num-mono">GET /api/runs/:id/download/jtl</td></tr>
              <tr><td style={{ color: "var(--text-muted)" }}>List saved configs</td><td className="num-mono">GET /api/saved-configs</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Monitoring integrations */}
      <div className="card" style={{ marginTop: 0 }}>
        <h3>Monitoring integrations</h3>
        <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Push live metrics to Datadog or New Relic during a run, or use a generic webhook
          to send to any monitoring platform. All are optional and free-tier compatible.
        </p>

        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label>
            <span className="label-text">Datadog API key</span>
            <input
              type="password"
              value={(settings as any).datadogApiKey || ""}
              placeholder="dddfxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              onChange={e => save({ datadogApiKey: e.target.value } as any)}
            />
          </label>
          <label>
            <span className="label-text">Datadog site</span>
            <select
              value={(settings as any).datadogSite || "datadoghq.com"}
              onChange={e => save({ datadogSite: e.target.value } as any)}
            >
              <option value="datadoghq.com">US (datadoghq.com)</option>
              <option value="datadoghq.eu">EU (datadoghq.eu)</option>
              <option value="us3.datadoghq.com">US3</option>
              <option value="us5.datadoghq.com">US5</option>
            </select>
          </label>
          <label>
            <span className="label-text">New Relic license key</span>
            <input
              type="password"
              value={(settings as any).newrelicLicenseKey || ""}
              placeholder="NRII-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              onChange={e => save({ newrelicLicenseKey: e.target.value } as any)}
            />
          </label>
          <label>
            <span className="label-text">Generic webhook URL</span>
            <input
              value={(settings as any).metricsWebhookUrl || ""}
              placeholder="https://your-monitoring-service.com/webhook"
              onChange={e => save({ metricsWebhookUrl: e.target.value } as any)}
            />
          </label>
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Metrics pushed every 5 seconds: <code>p95_ms</code>, <code>avg_ms</code>, <code>error_pct</code>, <code>throughput_rps</code>.
          Metric prefix: <code>loadpilot.*</code>
        </p>
      </div>
    </div>
  );
}
