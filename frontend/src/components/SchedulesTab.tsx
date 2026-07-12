import { useEffect, useState } from "react";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, Schedule } from "../api";
import ErrorAlert from "./ErrorAlert";

const CRON_PRESETS = [
  { label: "Daily at 2am",      value: "0 2 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every Monday 9am",  value: "0 9 * * 1" },
  { label: "Every hour",        value: "0 * * * *" },
  { label: "Every 6 hours",     value: "0 */6 * * *" },
  { label: "Custom",            value: "custom" },
];

function cronLabel(expr: string): string {
  const preset = CRON_PRESETS.find(p => p.value === expr);
  return preset ? preset.label : expr;
}

export default function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCron, setFormCron] = useState(CRON_PRESETS[0].value);
  const [formCustomCron, setFormCustomCron] = useState("");
  const [formConfig, setFormConfig] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const all = await listSchedules();
      setSchedules(all);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const cronExpr = formCron === "custom" ? formCustomCron.trim() : formCron;
    if (!formName.trim()) { setFormError("Give this schedule a name."); return; }
    if (!cronExpr) { setFormError("Choose a schedule."); return; }
    let config: any;
    try { config = JSON.parse(formConfig); } catch { setFormError("Config must be valid JSON — go to Build & Run, configure your test, then copy the config here."); return; }

    setSaving(true);
    setFormError(null);
    try {
      await createSchedule({ name: formName.trim(), config, cronExpr });
      setShowForm(false);
      setFormName(""); setFormCron(CRON_PRESETS[0].value); setFormConfig("");
      refresh();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(s: Schedule) {
    try {
      await updateSchedule(s.id, { enabled: !s.enabled });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSchedule(id);
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Scheduled Runs</h2>
        <p className="muted">
          Automatically run a saved test config on a schedule — daily, weekly, or custom.
          Results appear in Run Report history. Good for overnight soak tests and regression monitoring.
        </p>
      </div>

      {error && <ErrorAlert error={error} />}

      {/* How to get a config */}
      {!showForm && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>How to schedule a test</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
            <li>Go to <strong>Build &amp; Run</strong> and configure your test exactly as you want it to run automatically</li>
            <li>Click <strong>Save config</strong> (the save button in the configs section)</li>
            <li>Come back here and click <strong>Add schedule</strong> — paste the config JSON from the saved config</li>
            <li>Choose how often to run it and give it a name</li>
          </ol>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Tip: All times are in IST (Asia/Kolkata). The server must be running for scheduled tests to fire.
          </p>
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => setShowForm(v => !v)}>
          {showForm ? "Cancel" : "+ Add schedule"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>New scheduled run</h3>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label>
              <span className="label-text">Schedule name</span>
              <input value={formName} placeholder="e.g. Nightly soak test" onChange={e => setFormName(e.target.value)} />
            </label>
            <label>
              <span className="label-text">Frequency</span>
              <select value={formCron} onChange={e => setFormCron(e.target.value)}>
                {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
          </div>
          {formCron === "custom" && (
            <label style={{ display: "block", marginTop: 8 }}>
              <span className="label-text">Custom cron expression</span>
              <input value={formCustomCron} placeholder="e.g. 0 3 * * 1-5 (3am weekdays)" onChange={e => setFormCustomCron(e.target.value)} style={{ fontFamily: "monospace" }} />
              <span className="muted small-text">Format: minute hour day month weekday — <a href="https://crontab.guru" target="_blank" rel="noreferrer" style={{ color: "var(--accent-teal)" }}>crontab.guru</a></span>
            </label>
          )}
          <label style={{ display: "block", marginTop: 8 }}>
            <span className="label-text">Test config (JSON)</span>
            <textarea
              rows={8}
              value={formConfig}
              placeholder={'Paste your saved config JSON here — from Build & Run → Saved configs → copy icon'}
              onChange={e => setFormConfig(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 11 }}
            />
          </label>
          {formError && <div className="alert error" style={{ marginTop: 8 }}>{formError}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={handleCreate} disabled={saving}>{saving ? "Saving…" : "Save schedule"}</button>
            <button className="small" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading schedules…</p>
      ) : schedules.length === 0 ? (
        <div className="card">
          <p className="muted">No scheduled runs yet. Add one above to automate your testing.</p>
        </div>
      ) : (
        <div className="schedules-list">
          {schedules.map(s => (
            <div key={s.id} className={`schedule-card card ${s.enabled ? "schedule-card--on" : "schedule-card--off"}`}>
              <div className="schedule-card-header">
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {cronLabel(s.cronExpr)}
                    {s.lastRunAt && ` · Last ran ${new Date(s.lastRunAt).toLocaleString()}`}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className={`small ${s.enabled ? "" : "outline-btn"}`}
                    onClick={() => handleToggle(s)}
                  >
                    {s.enabled ? "⏸ Pause" : "▶ Enable"}
                  </button>
                  <button className="small danger-btn" onClick={() => handleDelete(s.id)}>Delete</button>
                </div>
              </div>
              <div className={`schedule-status ${s.enabled ? "schedule-status--on" : "schedule-status--off"}`}>
                {s.enabled ? "● Active" : "○ Paused"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
