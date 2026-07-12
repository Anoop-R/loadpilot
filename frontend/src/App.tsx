import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, BarChart3, BookOpen, Calendar, Database, Hammer, Link2, Settings, ShieldCheck } from "lucide-react";
import BuildRunTab from "./components/BuildRunTab";
import RunReportTab from "./components/RunReportTab";
import ResultsAnalysisTab from "./components/ResultsAnalysisTab";
import CorrelationDetectionTab from "./components/CorrelationDetectionTab";
import TestDataGeneratorTab from "./components/TestDataGeneratorTab";
import ScriptReviewTab from "./components/ScriptReviewTab";
import ConceptsTab from "./components/ConceptsTab";
import SchedulesTab from "./components/SchedulesTab";
import SettingsTab from "./components/SettingsTab";
import AuthBar from "./components/AuthBar";
import { RunRecord } from "./types";

const FLOW_TABS = [
  { id: "build",  label: "1. Build & Run", icon: Hammer },
  { id: "report", label: "2. Run Report",  icon: Activity },
] as const;

const TOOL_TABS = [
  { id: "results",     label: "Results Analysis", icon: BarChart3 },
  { id: "correlation", label: "Correlation",       icon: Link2 },
  { id: "testdata",    label: "Test Data",         icon: Database },
  { id: "review",      label: "Script Review",     icon: ShieldCheck },
  { id: "schedules",   label: "Schedules",         icon: Calendar },
  { id: "concepts",    label: "Learn Concepts",    icon: BookOpen },
  { id: "settings",    label: "Settings",          icon: Settings },
] as const;

type TabId = (typeof FLOW_TABS)[number]["id"] | (typeof TOOL_TABS)[number]["id"];

/** Shared data passed from Build & Run into the standalone tool tabs. */
export interface SharedJmxData {
  file: File;
  source: "generated"; // always from Build & Run for now
}

export interface SharedCorrelationData {
  prefill: string;   // pre-formatted text for the correlation textarea
  source: "auto-detect" | "run-results";
}

import { ToastProvider, useToast } from "./components/Toast";

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const [ready, setReady] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Wait one paint cycle before showing content — prevents half-rendered flash
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const [active, setActive] = useState<TabId>("build");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("loadpilot_theme") as "dark" | "light") || "dark"
  );

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("loadpilot_theme", theme);
    // Add theme-ready after first paint so transitions don't fire on load
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.add("theme-ready");
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey) return;

      const map: Record<string, TabId> = {
        "1": "build", "2": "report", "3": "results",
        "4": "correlation", "5": "testdata", "6": "review", "7": "concepts",
      };
      if (map[e.key]) { navigate(map[e.key]); return; }
      if (e.key === "t" || e.key === "T") setTheme(v => v === "dark" ? "light" : "dark");
      if (e.key === "[") setSidebarCollapsed(v => !v);
      if (e.key === "?") {
        // Show shortcuts hint
        alert("Keyboard shortcuts:\n1-7 — Switch tabs\nT — Toggle theme\n[ — Toggle sidebar\n? — This help");
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Shared data from Build & Run → standalone tabs
  const [sharedJmx, setSharedJmx] = useState<SharedJmxData | null>(null);
  const [sharedCorrelation, setSharedCorrelation] = useState<SharedCorrelationData | null>(null);
  const [sharedRunId, setSharedRunId] = useState<string | null>(null);
  const [sharedTestDataVars, setSharedTestDataVars] = useState<string[]>([]);

  const buildTabRef = useRef<{ applyConfig: (config: any) => void } | null>(null);

  function navigate(tab: TabId) {
    setActive(tab);
    setMobileNavOpen(false);
  }

  function handleRunStarted(run: RunRecord) {
    setSelectedRunId(run.id);
    navigate("report");
  }

  function handleRerunConfig(config: any) {
    navigate("build");
    setTimeout(() => buildTabRef.current?.applyConfig(config), 50);
  }

  function handleJmxGenerated(file: File) {
    setSharedJmx({ file, source: "generated" });
  }

  function handleCorrelationReady(prefill: string, source: SharedCorrelationData["source"]) {
    setSharedCorrelation({ prefill, source });
  }

  function handleOpenReview() {
    navigate("review");
  }

  function handleOpenCorrelation() {
    navigate("correlation");
  }

  function handleOpenResults(runId: string) {
    setSharedRunId(runId);
    navigate("results");
  }

  const allTabs = [...FLOW_TABS, ...TOOL_TABS];

  function renderActive() {
    switch (active) {
      case "build":
        return (
          <BuildRunTab
            ref={buildTabRef}
            onRunStarted={handleRunStarted}
            onJmxGenerated={handleJmxGenerated}
            onCorrelationReady={handleCorrelationReady}
            onOpenReview={handleOpenReview}
            onOpenCorrelation={handleOpenCorrelation}
            onTestDataVarsDetected={(vars) => {
              setSharedTestDataVars(vars);
              toast.info(`Test Data tab pre-filled with ${vars.length} variable${vars.length === 1 ? "" : "s"} from your config`);
            }}
          />
        );
      case "report":
        return (
          <RunReportTab
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onRerunConfig={handleRerunConfig}
            onOpenResults={handleOpenResults}
            onOpenCorrelation={(prefill) => {
              handleCorrelationReady(prefill, "run-results");
              navigate("correlation");
            }}
            onOpenReview={(file) => {
              setSharedJmx({ file, source: "generated" });
              navigate("review");
            }}
          />
        );
      case "results":
        return <ResultsAnalysisTab sharedRunId={sharedRunId} onClearShared={() => setSharedRunId(null)} />;
      case "correlation":
        return (
          <CorrelationDetectionTab
            sharedData={sharedCorrelation}
            onClearShared={() => setSharedCorrelation(null)}
          />
        );
      case "testdata":
        return <TestDataGeneratorTab sharedVars={sharedTestDataVars} onClearShared={() => setSharedTestDataVars([])} />;
      case "review":
        return (
          <ScriptReviewTab
            sharedJmx={sharedJmx}
            onClearShared={() => setSharedJmx(null)}
          />
        );
      case "settings":
        return <SettingsTab />;
      case "schedules":
        return <SchedulesTab />;
      case "concepts":
        return <ConceptsTab />;
    }
  }

  return (
    <div className={`app-shell ${mobileNavOpen ? "mobile-nav-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${ready ? "app-ready" : "app-loading"}`}>
      {mobileNavOpen && (
        <div className="mobile-overlay" onClick={() => setMobileNavOpen(false)} />
      )}

      <aside className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          {!sidebarCollapsed && (
            <div>
              <div className="brand-title">LoadPilot</div>
              <div className="brand-sub">Load testing, made simple</div>
            </div>
          )}
          <button
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed(v => !v)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? "›" : "‹"}
          </button>
        </div>

        <div className="sidebar-nav-scroll">
          {!sidebarCollapsed && <div className="nav-group-label">Guided flow</div>}
          <nav>
            {FLOW_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`nav-item ${tab.id === active ? "active" : ""} ${sidebarCollapsed ? "nav-item--icon-only" : ""}`}
                  onClick={() => navigate(tab.id)}
                  title={sidebarCollapsed ? tab.label : undefined}
                >
                  <Icon size={15} />
                  {!sidebarCollapsed && tab.label}
                </button>
              );
            })}
          </nav>

          {!sidebarCollapsed && <div className="nav-group-label">Tools</div>}
          {sidebarCollapsed && <div className="nav-group-divider" />}
          <nav>
            {TOOL_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`nav-item ${tab.id === active ? "active" : ""} ${sidebarCollapsed ? "nav-item--icon-only" : ""}`}
                  onClick={() => navigate(tab.id)}
                  title={sidebarCollapsed ? tab.label : undefined}
                >
                  <Icon size={15} />
                  {!sidebarCollapsed && tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          {!sidebarCollapsed && <AuthBar />}
          <div className="sidebar-bottom-actions">
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(v => v === "dark" ? "light" : "dark")}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode (T)`}
            >
              {theme === "dark" ? "☀" : "☾"}
              {!sidebarCollapsed && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
            </button>
            {!sidebarCollapsed && (
              <button className="shortcuts-hint-btn" title="Keyboard shortcuts" onClick={() =>
                alert("Keyboard shortcuts\n\n1–7   Switch tabs\nT      Toggle theme\n[      Toggle sidebar\n?      Show this help")
              }>⌨ Shortcuts</button>
            )}
          </div>
        </div>
      </aside>

      <main className="content">
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(v => !v)}>☰</button>
          <span className="mobile-topbar-title">
            {allTabs.find(t => t.id === active)?.label ?? "LoadPilot"}
          </span>
        </div>
        <div key={active} className="page-content">
          {renderActive()}
        </div>
      </main>
    </div>
  );
}
