"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Modal } from "./Modal";

// ── Toasts ────────────────────────────────────────────────────────────────────
// Replace `alert()` for results of an action ("Saved", "Couldn't approve: …").
// Errors stay longer and are announced assertively; successes are polite.

export type ToastTone = "success" | "error" | "info" | "warning";
export type ToastInput = { tone?: ToastTone; title: string; description?: string; durationMs?: number };
type ToastItem = Required<Pick<ToastInput, "tone" | "title">> & { id: number; description?: string };

export type ToastApi = {
  show: (t: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
};

// ── Confirm ───────────────────────────────────────────────────────────────────
// Replaces `window.confirm()`. `await confirm({...})` resolves true/false.

export type ConfirmOptions = {
  title: string;
  /** What will happen, naming the object: "Delete “Freshy Night”? Registrations are removed too." */
  message?: React.ReactNode;
  /** Repeat the verb: "Delete event", not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = destructive/irreversible: red button, focus starts on Cancel. */
  tone?: "danger" | "primary";
  /** For irreversible bulk actions: the user must type this exact text to enable the button. */
  requireText?: string;
};

type Ctx = { toast: ToastApi; confirm: (o: ConfirmOptions) => Promise<boolean> };
const FeedbackContext = createContext<Ctx | null>(null);

const TOAST_ICON: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 size={20} />,
  error: <XCircle size={20} />,
  info: <Info size={20} />,
  warning: <AlertTriangle size={20} />,
};

export function AdminFeedbackProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  const show = useCallback(
    ({ tone = "info", title, description, durationMs }: ToastInput) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, tone, title, description }]);
      const ms = durationMs ?? (tone === "error" || tone === "warning" ? 8000 : 4000);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const toast = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ tone: "success", title, description }),
      error: (title, description) => show({ tone: "error", title, description }),
      info: (title, description) => show({ tone: "info", title, description }),
      warning: (title, description) => show({ tone: "warning", title, description }),
    }),
    [show],
  );

  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setPending({ ...o, resolve });
      }),
    [],
  );

  const settle = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const danger = pending?.tone === "danger";
  const blocked = !!pending?.requireText && typed.trim() !== pending.requireText;

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        size="sm"
        title={pending?.title ?? ""}
        icon={danger ? <AlertTriangle size={20} /> : undefined}
        initialFocusRef={danger && !pending?.requireText ? cancelRef : undefined}
        footer={
          <>
            <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? t.adminUiCancel}
            </button>
            <button
              type="button"
              className={danger ? "btn adm-btn-danger-solid" : "btn btn-primary"}
              disabled={blocked}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? t.adminUiConfirm}
            </button>
          </>
        }
      >
        {(pending?.message || pending?.requireText) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {pending?.message && <div className="adm-modal-text">{pending.message}</div>}
            {pending?.requireText && (
              <div className="field">
                <label className="adm-field-label" htmlFor="adm-confirm-text">
                  {t.adminUiTypeToConfirm.replace("{text}", pending.requireText)}
                </label>
                <input
                  id="adm-confirm-text"
                  className="input"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !blocked) settle(true);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      <div className="adm-toast-region" aria-label={t.adminUiNotifications}>
        {toasts.map((x) => (
          <div
            key={x.id}
            className={`adm-toast adm-toast-${x.tone}`}
            role={x.tone === "error" ? "alert" : "status"}
            aria-live={x.tone === "error" ? "assertive" : "polite"}
          >
            <span className="adm-toast-icon" aria-hidden="true">{TOAST_ICON[x.tone]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="adm-toast-title">{x.title}</p>
              {x.description && <p className="adm-toast-desc">{x.description}</p>}
            </div>
            <button type="button" className="adm-toast-close" aria-label={t.adminUiDismiss} onClick={() => dismiss(x.id)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

// Outside the provider (should not happen under /admin) fall back to the browser
// dialogs so an action never silently does nothing.
const fallback: Ctx = {
  toast: {
    show: ({ title, description }) => window.alert(description ? `${title}\n${description}` : title),
    success: () => {},
    error: (title, description) => window.alert(description ? `${title}\n${description}` : title),
    info: () => {},
    warning: (title, description) => window.alert(description ? `${title}\n${description}` : title),
  },
  confirm: async (o) => window.confirm(o.title),
};

export function useToast(): ToastApi {
  return (useContext(FeedbackContext) ?? fallback).toast;
}

export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  return (useContext(FeedbackContext) ?? fallback).confirm;
}
