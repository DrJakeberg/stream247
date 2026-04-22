"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastRecord = Required<ToastInput> & { id: string };

const ToastContext = createContext<{
  pushToast: (toast: ToastInput) => void;
  dismissToast: (id: string) => void;
} | null>(null);

function buildToastId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timeoutHandles = useRef<Map<string, number>>(new Map());

  function dismissToast(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timeoutHandle = timeoutHandles.current.get(id);
    if (timeoutHandle) {
      window.clearTimeout(timeoutHandle);
      timeoutHandles.current.delete(id);
    }
  }

  function pushToast(toast: ToastInput) {
    const record: ToastRecord = {
      id: buildToastId(),
      title: toast.title,
      description: toast.description ?? "",
      tone: toast.tone ?? "info",
      durationMs: toast.durationMs ?? 4_000
    };

    setToasts((current) => [...current, record].slice(-4));
    const timeoutHandle = window.setTimeout(() => dismissToast(record.id), record.durationMs);
    timeoutHandles.current.set(record.id, timeoutHandle);
  }

  useEffect(() => {
    const handles = timeoutHandles.current;
    return () => {
      for (const timeoutHandle of handles.values()) {
        window.clearTimeout(timeoutHandle);
      }
      handles.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast }}>
      {props.children}
      <div aria-atomic="true" aria-live="polite" className="toast-viewport">
        {toasts.map((toast) => (
          <section
            className={`toast toast-${toast.tone}`}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <div className="toast-copy">
              <strong>{toast.title}</strong>
              {toast.description ? <p>{toast.description}</p> : null}
            </div>
            <button
              aria-label="Dismiss notification"
              className="toast-dismiss"
              onClick={() => dismissToast(toast.id)}
              type="button"
            >
              ×
            </button>
          </section>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider.");
  }

  return context;
}
