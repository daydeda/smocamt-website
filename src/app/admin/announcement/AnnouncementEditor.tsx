"use client";

import { useEffect, useRef, useState } from "react";
import { Megaphone, Save, Eye, EyeOff, Bold, Link2, AlertTriangle, Check } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { parseRichText } from "@/lib/rich-text";

export function AnnouncementEditor() {
  const { t } = useLanguage();
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/admin/announcement")
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.body === "string") setBody(d.body);
        if (d && typeof d.enabled === "boolean") setEnabled(d.enabled);
      })
      .finally(() => setLoading(false));
  }, []);

  // Replace the [start,end) range with `replacement` and re-select `selLen`
  // characters from `selStart`, keeping focus in the textarea.
  const apply = (start: number, end: number, replacement: string, selStart: number, selLen: number) => {
    const ta = taRef.current;
    setBody(body.slice(0, start) + replacement + body.slice(end));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(selStart, selStart + selLen);
    });
  };

  // Toggle a paired marker (e.g. **…**): strip it if the selection already has it
  // (markers inside OR immediately outside the selection), otherwise add it.
  const toggleWrap = (before: string, after: string, placeholder: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = body.slice(start, end);

    // Markers inside the selection -> remove them.
    if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)) {
      const inner = sel.slice(before.length, sel.length - after.length);
      apply(start, end, inner, start, inner.length);
      return;
    }
    // Markers just outside the selection -> remove them.
    if (body.slice(start - before.length, start) === before && body.slice(end, end + after.length) === after) {
      apply(start - before.length, end + after.length, sel, start - before.length, sel.length);
      return;
    }
    // Otherwise wrap.
    const inner = sel || placeholder;
    apply(start, end, before + inner + after, start + before.length, inner.length);
  };

  // Pick a color: replace the color of an existing {{color:…|…}} block instead of
  // nesting another one; otherwise wrap the selection in a new color block.
  const applyColor = (hex: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = body.slice(start, end);
    const m = sel.match(/^\{\{color:[^|]*\|([\s\S]*)\}\}$/);
    const inner = m ? m[1] : sel || "text";
    const block = `{{color:${hex}|${inner}}}`;
    apply(start, end, block, start, block.length);
  };

  // Toggle a link: unlink [label](url) back to label if the selection is a link,
  // otherwise insert [label](https://) with the cursor on the url.
  const toggleLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = body.slice(start, end);
    const m = sel.match(/^\[([\s\S]*?)\]\(([\s\S]*?)\)$/);
    if (m) {
      apply(start, end, m[1], start, m[1].length);
      return;
    }
    const label = sel || "link text";
    const url = "https://";
    apply(start, end, `[${label}](${url})`, start + `[${label}](`.length, url.length);
  };

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

  const toolBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 34,
    padding: "0 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-base)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
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
          width: "100%",
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

            {/* Formatting toolbar */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <button type="button" style={toolBtn} onClick={() => toggleWrap("**", "**", "text")} title="Bold / unbold — **text**">
                <Bold size={15} /> Bold
              </button>
              <button type="button" style={toolBtn} onClick={toggleLink} title="Link / unlink — [text](https://…)">
                <Link2 size={15} /> Link
              </button>
              <label style={{ ...toolBtn, position: "relative" }} title="Text color — {{color:#HEX|text}}">
                <span style={{ width: 15, height: 15, borderRadius: 4, background: "linear-gradient(135deg,var(--red-500),var(--indigo-500))", display: "inline-block" }} />
                Color
                <input
                  type="color"
                  defaultValue="#ff6b00"
                  onChange={(e) => applyColor(e.target.value)}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                />
              </label>
            </div>

            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
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
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              <code>**bold**</code> · <code>[text](https://…)</code> · <code>{`{{color:#ff6b00|text}}`}</code>
            </p>

            {/* Live preview */}
            <div style={{ marginTop: 20 }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-muted)" }}>
                Preview
              </label>
              <div className="alert alert-info" style={{ borderRadius: "var(--radius-lg)", padding: 20, background: "rgb(var(--accent-rgb) / 0.04)", border: "1px solid rgb(var(--accent-rgb) / 0.1)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-surface)", padding: 8, borderRadius: 12, boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.05)", color: "var(--accent-primary)", width: 40, height: 40, flexShrink: 0 }}>
                  <Megaphone size={22} />
                </div>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>ประกาศสำคัญ | Important Announcement</p>
                  <p
                    style={{ fontSize: 14, color: "var(--text-secondary)" }}
                    dangerouslySetInnerHTML={{ __html: parseRichText(body) }}
                  />
                </div>
              </div>
            </div>

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
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
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
                <span style={{ fontSize: 13, color: "var(--accent-success)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Check size={14} style={{ flexShrink: 0 }} /> {t.announcementSaved}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
