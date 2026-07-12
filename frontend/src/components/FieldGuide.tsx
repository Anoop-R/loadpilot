/**
 * FieldGuide — replaces InfoTip across the entire app.
 *
 * Clicking the ⓘ icon opens a floating panel with:
 *   • What this field does (plain English)
 *   • When to use it / when to leave it blank
 *   • A real-world example grounded in the user's context
 *   • Quick-fill chips to populate the field with one click
 *
 * Only one panel can be open at a time — opening a new one closes any
 * other. Closes on Escape, outside click, or the × button.
 *
 * Falls back gracefully when no guide content is provided: shows the
 * legacy hover-tooltip text instead (backward compat for any places
 * not yet migrated to rich content).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Info, X, Zap } from "lucide-react";

export interface QuickFillChip {
  label: string;       // Short name, e.g. "Light load"
  value: string;       // The actual value to fill in
  hint: string;        // One-line description, e.g. "5 users — just checking it works"
}

export interface FieldGuideContent {
  title: string;
  icon?: string;                         // emoji shown in the panel header
  what: string;                          // What this field does — plain English
  when?: string;                         // When to use it / when to leave it blank
  example?: { context: string; text: string }; // Real-world example
  chips?: QuickFillChip[];               // Quick-fill options
  onFill?: (value: string) => void;      // Called when user clicks a chip
}

interface FieldGuideProps {
  guide?: FieldGuideContent;
  text?: string;  // legacy text-only tooltip (still works)
}

// Module-level broadcast — ensures only one panel is open at a time
// without needing a React context wrapping the whole app.
let closeCurrentGuide: (() => void) | null = null;

export default function FieldGuide({ guide, text }: FieldGuideProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, flipUp: false, flipLeft: false });
  const [visible, setVisible] = useState(false); // controls the CSS animation
  const iconRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(() => setOpen(false), 180); // wait for fade-out animation
  }, []);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) { close(); return; }

    // Close any other open guide
    if (closeCurrentGuide && closeCurrentGuide !== close) closeCurrentGuide();
    closeCurrentGuide = close;

    // Calculate position
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const panelW = 360;
      const panelH = 420; // estimated
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const flipLeft = rect.right + panelW + 12 > vw;
      const flipUp = rect.bottom + panelH + 12 > vh;

      setPos({
        top: flipUp ? rect.top - panelH - 8 : rect.bottom + 8,
        left: flipLeft ? rect.left - panelW + 20 : rect.left - 8,
        flipUp,
        flipLeft,
      });
    }
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          iconRef.current && !iconRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // If no guide content, fall back to hover tooltip
  if (!guide) {
    return (
      <span className="info-tip" tabIndex={0}>
        <Info size={13} strokeWidth={2.2} />
        {text && <span className="info-tip-bubble" role="tooltip">{text}</span>}
      </span>
    );
  }

  return (
    <>
      <button
        ref={iconRef}
        className={`guide-icon ${open ? "guide-icon--active" : ""}`}
        onClick={handleOpen}
        aria-label={`Learn about: ${guide.title}`}
        type="button"
      >
        <Info size={13} strokeWidth={2.2} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className={`guide-panel ${visible ? "guide-panel--visible" : ""} ${pos.flipUp ? "guide-panel--flip-up" : ""}`}
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label={guide.title}
        >
          {/* Arrow */}
          <div className={`guide-arrow ${pos.flipUp ? "guide-arrow--up" : "guide-arrow--down"} ${pos.flipLeft ? "guide-arrow--right" : "guide-arrow--left"}`} />

          {/* Header */}
          <div className="guide-header">
            <span className="guide-title">
              {guide.icon && <span className="guide-icon-emoji">{guide.icon}</span>}
              {guide.title}
            </span>
            <button className="guide-close" onClick={close} type="button" aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className="guide-body">
            {/* What it does */}
            <div className="guide-section">
              <div className="guide-section-label">What this does</div>
              <p className="guide-text">{guide.what}</p>
            </div>

            {/* When to use it */}
            {guide.when && (
              <div className="guide-section">
                <div className="guide-section-label">When to use it</div>
                <p className="guide-text">{guide.when}</p>
              </div>
            )}

            {/* Real example */}
            {guide.example && (
              <div className="guide-section guide-example">
                <div className="guide-section-label">Real example</div>
                <div className="guide-example-context">{guide.example.context}</div>
                <p className="guide-text guide-example-text">"{guide.example.text}"</p>
              </div>
            )}

            {/* Quick-fill chips */}
            {guide.chips && guide.chips.length > 0 && guide.onFill && (
              <div className="guide-section">
                <div className="guide-section-label">Quick fill</div>
                <div className="guide-chips">
                  {guide.chips.map((chip, i) => (
                    <button
                      key={i}
                      className="guide-chip"
                      type="button"
                      onClick={() => { guide.onFill!(chip.value); close(); }}
                    >
                      <span className="guide-chip-icon"><Zap size={10} /></span>
                      <span className="guide-chip-label">{chip.label}</span>
                      <span className="guide-chip-hint">{chip.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
