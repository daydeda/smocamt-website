"use client";

import { AlertTriangle, Inbox, RefreshCcw } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/** Spinner or skeleton rows while data loads. Announced to screen readers. */
export function LoadingState({
  label,
  variant = "spinner",
  rows = 4,
  compact,
}: {
  label?: string;
  variant?: "spinner" | "skeleton";
  rows?: number;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const text = label ?? t.adminUiLoading;
  if (variant === "skeleton") {
    return (
      <div role="status" aria-label={text} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={56} />
        ))}
      </div>
    );
  }
  return (
    <div role="status" className={`adm-state${compact ? " adm-state-compact" : ""}`}>
      <div className="spinner" style={{ width: 28, height: 28 }} aria-hidden="true" />
      <p className="adm-state-desc">{text}</p>
    </div>
  );
}

export function Skeleton({ width = "100%", height = 16, radius = 12 }: { width?: number | string; height?: number | string; radius?: number }) {
  return <div className="adm-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** Nothing to show. Always say why, and offer the next step when there is one. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: React.ReactNode;
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className={`adm-state${compact ? " adm-state-compact" : ""}`}>
      <span className="adm-state-icon" aria-hidden="true">{icon ?? <Inbox size={24} />}</span>
      <p className="adm-state-title">{title ?? t.adminUiEmptyTitle}</p>
      {description && <p className="adm-state-desc">{description}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/** A load failed. Says what happened and offers Retry. */
export function ErrorState({
  title,
  message,
  onRetry,
  compact,
}: {
  title?: string;
  message?: React.ReactNode;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div role="alert" className={`adm-state adm-state-error${compact ? " adm-state-compact" : ""}`}>
      <span className="adm-state-icon" aria-hidden="true"><AlertTriangle size={24} /></span>
      <p className="adm-state-title">{title ?? t.adminUiErrorTitle}</p>
      <p className="adm-state-desc">{message ?? t.adminUiErrorBody}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onRetry}>
          <RefreshCcw size={16} aria-hidden="true" />
          {t.adminUiRetry}
        </button>
      )}
    </div>
  );
}

/** Inline message inside a form or panel (not a toast): validation summaries, notices. */
export function InlineAlert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`adm-inline-alert adm-inline-alert-${tone}`} role={tone === "error" ? "alert" : undefined}>
      {title && <p style={{ fontWeight: 700 }}>{title}</p>}
      {children && <div>{children}</div>}
    </div>
  );
}
