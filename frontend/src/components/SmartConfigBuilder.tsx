/**
 * SmartConfigBuilder — unified config assistant with two modes.
 *
 * Tab 1 "Describe it": User types a plain-English description. AI fills
 * the form immediately if it has enough info, or asks one follow-up question.
 *
 * Tab 2 "Guide me through": Structured step-by-step walkthrough. AI asks
 * one focused question per section (URL → method/auth → load → pass/fail)
 * and explains what it's asking and why. Good for first-time users.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, RotateCcw, Clock } from "lucide-react";
import { converse, parseDescription } from "../api";
import ErrorAlert from "./ErrorAlert";
import { ParsedConfigSuggestion } from "../types";

const HISTORY_KEY = "loadpilot_chat_history";
const MAX_HISTORY = 5;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function saveHistory(input: string) {
  const t = input.trim();
  if (!t) return;
  const h = loadHistory().filter(x => x !== t);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([t, ...h].slice(0, MAX_HISTORY)));
}

interface ChatMsg { role: "user" | "assistant"; content: string; parsed?: any; }

// Guided walkthrough steps
const GUIDE_STEPS = [
  {
    key: "url",
    question: "What's the URL of the API you want to test?",
    hint: "Paste the full URL — e.g. https://api.example.com/endpoint. I'll handle the rest.",
  },
  {
    key: "method_body",
    question: "What HTTP method does this endpoint use, and what does the request body look like?",
    hint: "e.g. POST with a JSON body, or GET with no body. Paste a sample body if you have one.",
  },
  {
    key: "auth",
    question: "Does this API require any authentication headers?",
    hint: "e.g. 'x-api-key: abc123' or 'Authorization: Bearer token'. If there's no auth, just say 'no'.",
  },
  {
    key: "load",
    question: "How many users do you want to simulate, and for how long?",
    hint: "e.g. '10 users for 2 minutes' or '40 users for 60 seconds'. If unsure, start with 10 users for 1 minute.",
  },
  {
    key: "success",
    question: "What does a successful response look like?",
    hint: "Usually just HTTP 200. Or if you need to check the content too — e.g. 'status 200 and the response contains a results field'.",
  },
];

export default function SmartConfigBuilder({
  onApply,
  onApplyParsed,
}: {
  onApply: (config: any) => void;
  onApplyParsed: (s: ParsedConfigSuggestion) => void;
}) {
  const [tab, setTab] = useState<"describe" | "guide">("describe");

  // Describe tab state
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatMode, setChatMode] = useState<"idle" | "loading" | "chat">("idle");
  const [applied, setApplied] = useState(false);
  const [applyFlash, setApplyFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  // Guide tab state
  const [guideStep, setGuideStep] = useState(0);
  const [guideAnswers, setGuideAnswers] = useState<Record<string, string>>({});
  const [guideInput, setGuideInput] = useState("");
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideDone, setGuideDone] = useState(false);
  const [guideProposal, setGuideProposal] = useState<any>(null);
  const [guideApplied, setGuideApplied] = useState(false);
  const [guideApplyFlash, setGuideApplyFlash] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const guideInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, chatMode]);

  useEffect(() => {
    if (!showHistory) return;
    function h(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) setShowHistory(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showHistory]);

  function flashApply(setFn: (v: boolean) => void) {
    setFn(true);
    setTimeout(() => setFn(false), 2000);
  }

  // ── Describe tab ──────────────────────────────────────────────────────────

  async function handleDescribeSubmit() {
    const text = input.trim();
    if (!text || chatMode === "loading") return;
    saveHistory(text);
    setHistory(loadHistory());
    setInput("");
    setError(null);
    setApplied(false);
    setChatMode("loading");

    try {
      const quick = await parseDescription(text);
      const hasEnough = quick.config && (quick.config.domain || quick.config.users || quick.config.method);
      if (hasEnough) {
        setMessages([
          { role: "user", content: text },
          { role: "assistant", content: quick.notes || "Got it — here's what I understood:", parsed: { type: "proposal", message: quick.notes || "Here's what I understood:", config: quick.config, ready: true } },
        ]);
        setChatMode("chat");
        return;
      }
    } catch { /* fall through */ }

    const userMsg: ChatMsg = { role: "user", content: text };
    setMessages([userMsg]);
    try {
      const result = await converse([{ role: "user", content: text }]);
      setMessages([userMsg, { role: "assistant", content: result.message || "", parsed: result }]);
      setChatMode("chat");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
      setChatMode("idle");
    }
  }

  async function handleChatReply() {
    const text = input.trim();
    if (!text || chatMode === "loading") return;
    setInput("");
    setChatMode("loading");
    const userMsg: ChatMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    try {
      const history = newMessages.map(m => ({ role: m.role, content: m.parsed?.message ?? m.content }));
      const result = await converse(history);
      setMessages(prev => [...prev, { role: "assistant", content: result.message || "", parsed: result }]);
      setChatMode("chat");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
      setChatMode("chat");
    }
  }

  function handleDescribeApply(config: any) {
    onApply(config);
    setApplied(true);
    flashApply(setApplyFlash);
  }

  function resetDescribe() {
    setMessages([]);
    setInput("");
    setChatMode("idle");
    setApplied(false);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleDescribeKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (chatMode === "chat" && messages.length > 0) handleChatReply();
      else handleDescribeSubmit();
    }
  }

  const lastMsg = messages[messages.length - 1];
  const proposal = lastMsg?.parsed?.type === "proposal" ? lastMsg.parsed : null;

  // ── Guide tab ─────────────────────────────────────────────────────────────

  async function handleGuideNext() {
    const answer = guideInput.trim();
    if (!answer) return;
    const step = GUIDE_STEPS[guideStep];
    const newAnswers = { ...guideAnswers, [step.key]: answer };
    setGuideAnswers(newAnswers);
    setGuideInput("");

    if (guideStep < GUIDE_STEPS.length - 1) {
      setGuideStep(s => s + 1);
      setTimeout(() => guideInputRef.current?.focus(), 80);
      return;
    }

    // Last step — synthesise config
    setGuideLoading(true);
    try {
      const summary =
        `URL: ${newAnswers.url}\n` +
        `Method and body: ${newAnswers.method_body}\n` +
        `Auth: ${newAnswers.auth}\n` +
        `Load: ${newAnswers.load}\n` +
        `Success criteria: ${newAnswers.success}`;
      const quick = await parseDescription(summary);
      setGuideProposal(quick.config);
      setGuideDone(true);
    } catch (e: any) {
      setError("Couldn't generate config from your answers — try the Describe tab instead.");
    } finally {
      setGuideLoading(false);
    }
  }

  function handleGuideApply() {
    if (!guideProposal) return;
    onApply(guideProposal);
    setGuideApplied(true);
    flashApply(setGuideApplyFlash);
  }

  function resetGuide() {
    setGuideStep(0);
    setGuideAnswers({});
    setGuideInput("");
    setGuideDone(false);
    setGuideProposal(null);
    setGuideApplied(false);
    setTimeout(() => guideInputRef.current?.focus(), 80);
  }

  function handleGuideKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGuideNext();
    }
  }

  const progress = ((guideStep) / GUIDE_STEPS.length) * 100;

  return (
    <div className="smart-builder card">
      <div className="smart-builder-header">
        <h3>
          <Sparkles size={15} style={{ marginRight: 6, color: "var(--accent-amber)" }} />
          Set up with AI
        </h3>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {(messages.length > 0 || guideStep > 0 || guideDone) && (
            <button className="icon-btn" onClick={tab === "describe" ? resetDescribe : resetGuide} title="Start over">
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="smart-builder-tabs">
        <button
          className={`smart-builder-tab ${tab === "describe" ? "active" : ""}`}
          onClick={() => setTab("describe")}
        >
          Describe it
        </button>
        <button
          className={`smart-builder-tab ${tab === "guide" ? "active" : ""}`}
          onClick={() => setTab("guide")}
        >
          Guide me through
        </button>
      </div>

      {/* ── Describe tab ── */}
      {tab === "describe" && (
        <div className="smart-builder-tab-content">
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Describe your test in plain English. If you have enough detail the form fills instantly —
            if not, it'll ask one follow-up question.
          </p>

          {messages.length > 0 && (
            <div className="smart-builder-messages" ref={messagesRef}>
              {messages.map((msg, i) => {
                const text = msg.parsed?.message || msg.content;
                return (
                  <div key={i} className={`smart-builder-bubble smart-builder-bubble--${msg.role}`}>
                    {msg.role === "assistant" && <span className="smart-builder-avatar">✦</span>}
                    <div className="smart-builder-text">{text}</div>
                  </div>
                );
              })}
              {chatMode === "loading" && (
                <div className="smart-builder-bubble smart-builder-bubble--assistant">
                  <span className="smart-builder-avatar">✦</span>
                  <div className="smart-chat-typing"><span /><span /><span /></div>
                </div>
              )}
            </div>
          )}

          {proposal?.ready && proposal.config && (
            <div className="smart-builder-proposal">
              <div className="smart-builder-proposal-label">Ready to apply</div>
              <div className="smart-builder-proposal-rows">
                {[
                  proposal.config.domain ? ["URL", `${proposal.config.protocol || "https"}://${proposal.config.domain}${proposal.config.path || "/"}`] : null,
                  proposal.config.method ? ["Method", proposal.config.method] : null,
                  proposal.config.users != null ? ["Users", String(proposal.config.users)] : null,
                  proposal.config.durationSeconds != null ? ["Duration", `${proposal.config.durationSeconds}s`] : null,
                ].filter(Boolean).map(([label, value]: any, i) => (
                  <div key={i} className="smart-builder-proposal-row">
                    <span className="smart-builder-proposal-key">{label}</span>
                    <span className="smart-builder-proposal-val">{value}</span>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
                <button onClick={() => handleDescribeApply(proposal.config)} disabled={applied} className={applyFlash ? "btn-flash" : ""}>
                  {applied ? "✓ Applied to form" : "Apply to form"}
                </button>
                <button className="small" onClick={resetDescribe}>Start over</button>
                {applyFlash && <span className="apply-flash-msg">Settings filled in below ↓</span>}
              </div>
              {applied && <p className="muted small-text" style={{ marginTop: 6 }}>Scroll down to review and adjust before running.</p>}
            </div>
          )}

          {error && <div className="alert error" style={{ marginTop: 8 }}>{error}</div>}

          {!proposal?.ready && (
            <div className="smart-builder-input-row">
              <textarea
                ref={inputRef}
                rows={chatMode === "idle" ? 3 : 2}
                value={input}
                placeholder={
                  chatMode === "idle"
                    ? "e.g. POST to https://hindalco.den.devum.com/devum/backendActions/execute with header appcode:immis, 10 users for 2 minutes"
                    : "Your answer…"
                }
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleDescribeKey}
                disabled={chatMode === "loading"}
              />
              <div className="smart-builder-input-actions">
                {history.length > 0 && (
                  <div ref={historyRef} style={{ position: "relative" }}>
                    <button className="small icon-btn" onClick={() => setShowHistory(v => !v)} title="Recent inputs">
                      <Clock size={13} />
                    </button>
                    {showHistory && (
                      <ul className="chat-history-dropdown">
                        <li className="chat-history-label">Recent inputs</li>
                        {history.map((item, i) => (
                          <li key={i} className="chat-history-item" onClick={() => { setInput(item); setShowHistory(false); }}>
                            {item.length > 80 ? item.slice(0, 80) + "…" : item}
                          </li>
                        ))}
                        <li className="chat-history-clear" onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); setShowHistory(false); }}>
                          Clear history
                        </li>
                      </ul>
                    )}
                  </div>
                )}
                <button
                  className="smart-chat-send"
                  onClick={chatMode === "chat" ? handleChatReply : handleDescribeSubmit}
                  disabled={chatMode === "loading" || !input.trim()}
                  title="Send (Enter)"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          )}
          {!proposal?.ready && chatMode === "idle" && (
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Press Enter to send · Shift+Enter for new line</p>
          )}
        </div>
      )}

      {/* ── Guide me through tab ── */}
      {tab === "guide" && (
        <div className="smart-builder-tab-content">
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Answer a few focused questions and the form fills automatically.
            Good for first-time load tests or unfamiliar APIs.
          </p>

          {!guideDone ? (
            <>
              {/* Progress bar */}
              <div className="guide-progress-bar">
                <div className="guide-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 12 }}>
                Step {guideStep + 1} of {GUIDE_STEPS.length}
              </p>

              {/* Previous answers */}
              {guideStep > 0 && (
                <div className="guide-answers-summary">
                  {GUIDE_STEPS.slice(0, guideStep).map(s => (
                    <div key={s.key} className="guide-answer-row">
                      <span className="guide-answer-label">{s.question.split("?")[0]}?</span>
                      <span className="guide-answer-val">{guideAnswers[s.key]?.slice(0, 60)}{(guideAnswers[s.key]?.length || 0) > 60 ? "…" : ""}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Current question */}
              <div className="guide-question-card">
                <div className="guide-question-text">{GUIDE_STEPS[guideStep].question}</div>
                <div className="guide-question-hint muted">{GUIDE_STEPS[guideStep].hint}</div>
              </div>

              <div className="smart-builder-input-row" style={{ marginTop: 8 }}>
                <textarea
                  ref={guideInputRef}
                  rows={3}
                  value={guideInput}
                  placeholder="Your answer…"
                  onChange={e => setGuideInput(e.target.value)}
                  onKeyDown={handleGuideKey}
                  disabled={guideLoading}
                  autoFocus
                />
                <div className="smart-builder-input-actions">
                  <button
                    className="smart-chat-send"
                    onClick={handleGuideNext}
                    disabled={guideLoading || !guideInput.trim()}
                    title="Next (Enter)"
                  >
                    {guideLoading ? "…" : <Send size={14} />}
                  </button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Enter to continue · Shift+Enter for new line
                {guideStep > 0 && (
                  <button className="link-btn" style={{ marginLeft: 12, fontSize: 11 }} onClick={() => setGuideStep(s => s - 1)}>
                    ← Back
                  </button>
                )}
              </p>
            </>
          ) : (
            <>
              {guideProposal && (
                <div className="smart-builder-proposal">
                  <div className="smart-builder-proposal-label">Config built from your answers</div>
                  <div className="smart-builder-proposal-rows">
                    {[
                      guideProposal.domain ? ["URL", `${guideProposal.protocol || "https"}://${guideProposal.domain}${guideProposal.path || "/"}`] : null,
                      guideProposal.method ? ["Method", guideProposal.method] : null,
                      guideProposal.users != null ? ["Users", String(guideProposal.users)] : null,
                      guideProposal.rampUpSeconds != null ? ["Ramp-up", `${guideProposal.rampUpSeconds}s`] : null,
                      guideProposal.durationSeconds != null ? ["Duration", `${guideProposal.durationSeconds}s`] : null,
                      guideProposal.expectedStatusCode ? ["Expected status", guideProposal.expectedStatusCode] : null,
                    ].filter(Boolean).map(([label, value]: any, i) => (
                      <div key={i} className="smart-builder-proposal-row">
                        <span className="smart-builder-proposal-key">{label}</span>
                        <span className="smart-builder-proposal-val">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
                    <button onClick={handleGuideApply} disabled={guideApplied} className={guideApplyFlash ? "btn-flash" : ""}>
                      {guideApplied ? "✓ Applied to form" : "Apply to form"}
                    </button>
                    <button className="small" onClick={resetGuide}>Start over</button>
                    {guideApplyFlash && <span className="apply-flash-msg">Settings filled in below ↓</span>}
                  </div>
                  {guideApplied && <p className="muted small-text" style={{ marginTop: 6 }}>Scroll down to review and adjust before running.</p>}
                </div>
              )}
            </>
          )}

          {error && <div className="alert error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
