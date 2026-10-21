"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { PRIVACY_COPY, PRIVACY_UPDATED, PrivacySections, privacyLangFor } from "@/components/PrivacyPolicyContent";

/**
 * Full privacy policy in a dialog, opened from the onboarding PDPA consent step.
 * It keeps the student on the onboarding page: following a link to /privacy let
 * an unfinished profile wander off to the dashboard and lose the form.
 */
export function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  const { lang, t } = useLanguage();
  const active = privacyLangFor(lang);
  const c = PRIVACY_COPY[active];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgb(var(--scrim-rgb) / 0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100%, 640px)",
          maxHeight: "min(88vh, 820px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-base)",
          color: "var(--text-primary)",
          borderRadius: 24,
          boxShadow: "0 30px 70px rgb(var(--shadow-rgb) / 0.35)",
          border: "1px solid var(--border-medium)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "20px 20px 16px",
            borderBottom: "1px solid var(--border-medium)",
            background: "var(--bg-surface)",
          }}
        >
          <div>
            <h2 id="privacy-modal-title" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>
              {c.pageTitle}
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {c.updated}: {PRIVACY_UPDATED}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t.privacyModalClose}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "16px 16px 20px", overscrollBehavior: "contain" }}>
          <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text-secondary)", marginBottom: 14 }}>{c.intro}</p>
          <PrivacySections lang={active} compact />
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 16px 16px", borderTop: "1px solid var(--border-medium)", background: "var(--bg-surface)" }}>
          <button type="button" className="btn btn-primary" onClick={onClose} style={{ width: "100%" }}>
            {t.privacyModalDone}
          </button>
        </div>
      </div>
    </div>
  );
}
