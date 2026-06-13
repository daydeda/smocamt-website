"use client";

import { useEffect, useState } from "react";
import { Megaphone, Save, Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";

export function AnnouncementEditor() {
  const { t } = useLanguage();
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/announcement")
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.body === "string") setBody(d.body);
        if (d && typeof d.enabled === "boolean") setEnabled(d.enabled);
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/announcement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, enabled }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || "Failed to save");
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 12 }}>
          <Megaphone size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
          {t.manageAnnouncement}
        </h1>
      </div>

      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          maxWidth: 720,
        }}
      >
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <div className="spinner" style={{ width: 28, height: 28 }} />
          </div>
        ) : (
          <>
            {/* Body */}
            <label style={{ display: "block", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
              {t.announcementBodyLabel}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder={t.announcementBodyPlaceholder}
              style={{
                width: "100%",
                padding: 14,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
                fontSize: 15,
                lineHeight: 1.6,
                resize: "vertical",
                fontFamily: "inherit",
                background: "var(--bg-base)",
              }}
            />
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
              {t.announcementBodyHint}
            </p>

            {/* Show on dashboard toggle */}
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className="btn btn-ghost"
              style={{ marginTop: 20, display: "inline-flex", alignItems: "center", gap: 10 }}
            >
              {enabled ? <Eye size={18} /> : <EyeOff size={18} />}
              <span style={{ fontWeight: 600 }}>
                {enabled ? t.announcementVisibleOn : t.announcementVisibleOff}
              </span>
            </button>

            {error && (
              <div className="alert alert-error" style={{ marginTop: 20, fontSize: 13 }}>
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Save */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 28 }}>
              <button
                type="button"
                onClick={save}
                disabled={saving || body.trim() === ""}
                className="btn btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <Save size={18} />
                {saving ? t.saving : t.saveChanges}
              </button>
              {savedAt && !saving && (
                <span style={{ fontSize: 13, color: "var(--accent-success, #16a34a)", fontWeight: 600 }}>
                  ✓ {t.announcementSaved}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
