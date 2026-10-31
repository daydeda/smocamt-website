"use client";

import { RichTextEditor } from "@/components/RichTextEditor";
import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Megaphone, Save } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { parseRichText } from "@/lib/ui/rich-text";
import { ErrorState, InlineAlert, LoadingState, PageHeader, Panel, StatusBadge, useToast } from "@/components/admin/ui";

export function AnnouncementEditor() {
  const { t } = useLanguage();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    fetch("/api/admin/announcement")
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.body === "string") setBody(d.body);
        if (d && typeof d.enabled === "boolean") setEnabled(d.enabled);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred so the loading flag flips outside the synchronous effect body.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const save = async () => {
    if (saving) return;
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
        throw new Error(d?.error || t.adminOvAnnSaveFailed);
      }
      toast.success(t.announcementSaved, enabled ? t.announcementVisibleOn : t.announcementVisibleOff);
    } catch (e) {
      const message = e instanceof Error ? e.message : t.adminOvAnnSaveFailed;
      setError(message);
      toast.error(t.adminOvAnnSaveFailed, message);
    } finally {
      setSaving(false);
    }
  };

  const empty = body.trim() === "";

  return (
    <div className="pb-20">
      <PageHeader title={t.manageAnnouncement} description={t.adminOvAnnDesc} />

      {loading ? (
        <LoadingState />
      ) : loadFailed ? (
        <ErrorState onRetry={load} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
          <Panel title={t.announcementBodyLabel} icon={<Megaphone size={18} />}>
            <div role="group" aria-label={t.announcementBodyLabel}>
              <RichTextEditor
                value={body}
                onChange={setBody}
                rows={6}
                showPreview={false}
                placeholder={t.announcementBodyPlaceholder}
                hint={t.announcementBodyHint}
              />
            </div>
            {empty && (
              <p className="adm-field-hint" style={{ marginTop: 8 }}>
                {t.adminOvAnnEmptyHint}
              </p>
            )}
          </Panel>

          <Panel
            title={t.adminOvAnnPreview}
            description={t.adminOvAnnPreviewDesc}
            actions={
              enabled ? (
                <StatusBadge tone="success" icon={<Eye size={12} />}>{t.announcementVisibleOn}</StatusBadge>
              ) : (
                <StatusBadge tone="neutral" icon={<EyeOff size={12} />}>{t.announcementVisibleOff}</StatusBadge>
              )
            }
          >
            <div className="alert alert-info" style={{ borderRadius: "var(--radius-lg)", padding: 20, background: "rgb(var(--accent-rgb) / 0.04)", border: "1px solid rgb(var(--accent-rgb) / 0.1)", opacity: enabled ? 1 : 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-surface)", padding: 8, borderRadius: 12, color: "var(--accent-primary)", width: 40, height: 40, flexShrink: 0 }} aria-hidden="true">
                <Megaphone size={22} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>ประกาศสำคัญ | Important Announcement</p>
                <p
                  style={{ fontSize: 14, color: "var(--text-secondary)", overflowWrap: "anywhere" }}
                  dangerouslySetInnerHTML={{ __html: parseRichText(body) }}
                />
              </div>
            </div>
          </Panel>

          <Panel title={t.adminOvAnnVisibility}>
            <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, cursor: "pointer", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={saving}
                style={{ width: 20, height: 20, accentColor: "var(--accent-primary)" }}
              />
              {t.adminOvAnnShowLabel}
            </label>
            <p className="adm-field-hint" style={{ marginTop: 4 }}>
              {enabled ? t.announcementVisibleOn : t.announcementVisibleOff}
            </p>
          </Panel>

          {error && <InlineAlert tone="error" title={t.adminOvAnnSaveFailed}>{error}</InlineAlert>}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={save} disabled={saving || empty} className="btn btn-primary" style={{ gap: 8 }}>
              {saving ? <div className="spinner" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
              {saving ? t.saving : t.saveChanges}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
