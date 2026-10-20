"use client";

import { useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";

/**
 * Periodic (every 3 months) prompt to re-confirm personal / medical / emergency
 * info. No backdrop or X dismiss on purpose: the student picks one of the two
 * actions. "Update" just closes it so they can edit the form (saving stamps the
 * review server-side); "Keep" confirms via POST /api/profile/review.
 */
export function ProfileReviewModal({
  onUpdate,
  onKept,
}: {
  onUpdate: () => void;
  onKept: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const keep = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/profile/review", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      onKept();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-review-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgb(var(--scrim-rgb) / 0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="animate-fade-in-up"
        style={{
          width: "min(92vw, 400px)",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          borderRadius: 28,
          padding: "32px 24px 24px",
          textAlign: "center",
          boxShadow: "0 30px 70px rgb(var(--shadow-rgb) / 0.35)",
          border: "1px solid var(--accent-primary)33",
        }}
      >
        <ClipboardCheck size={44} style={{ color: "var(--accent-primary)", margin: "0 auto 14px", display: "block" }} />
        <h2 id="profile-review-title" style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
          {t.profileReviewTitle}
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 20 }}>
          {t.profileReviewDesc}
        </p>
        {failed && (
          <p style={{ fontSize: 13, color: "var(--red-500)", fontWeight: 600, marginBottom: 12 }}>{t.profileReviewError}</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" className="btn btn-primary" onClick={onUpdate} disabled={busy}>
            {t.profileReviewUpdate}
          </button>
          <button type="button" className="btn btn-ghost" onClick={keep} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : t.profileReviewKeep}
          </button>
        </div>
      </div>
    </div>
  );
}
