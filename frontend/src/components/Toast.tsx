/**
 * Global toast notification system.
 * Usage: import { useToast } from './Toast'
 * const { toast } = useToast();
 * toast.success("Config applied!") / toast.error("...") / toast.info("...")
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warn";

export interface ToastMsg {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastCtx {
  toasts: ToastMsg[];
  show: (type: ToastType, message: string, durationMs?: number) => void;
}

const Ctx = createContext<ToastCtx>({ toasts: [], show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const show = useCallback((type: ToastType, message: string, durationMs = 3000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), durationMs);
  }, []);

  return (
    <Ctx.Provider value={{ toasts, show }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            <span className="toast-icon">
              {t.type === "success" ? "✓" : t.type === "error" ? "⚠" : t.type === "warn" ? "⚡" : "ℹ"}
            </span>
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const { show } = useContext(Ctx);
  return {
    toast: {
      success: (msg: string, ms?: number) => show("success", msg, ms),
      error:   (msg: string, ms?: number) => show("error",   msg, ms ?? 5000),
      info:    (msg: string, ms?: number) => show("info",    msg, ms),
      warn:    (msg: string, ms?: number) => show("warn",    msg, ms ?? 4000),
    },
  };
}
