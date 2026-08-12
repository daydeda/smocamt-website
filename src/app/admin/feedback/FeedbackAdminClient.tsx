"use client";

import { useEffect, useState } from "react";
import { MessageSquareWarning, Loader2, Send, X, ShieldOff } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import {
  FEEDBACK_SEVERITY_META,
  FEEDBACK_STATUS_META,
  categoryMeta,
} from "@/lib/feedback-ui";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackSeverity,
  type FeedbackStatus,
} from "@/lib/feedback-token";

interface ThreadMessage {
  id: string;
  senderType: "submitter" | "staff";
  body: string;
  createdAt: string;
}

interface Complaint {
  id: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  message: string;
  contactOptIn: boolean;
  contactInfo: string | null;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

export function FeedbackAdminClient() {
  const { t } = useLanguage();
  const tr = t as Record<string, string>;
  const tt = (key: string, fallback: string) => tr[key] || fallback;

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FeedbackStatus | "all">("new");
  const [filterCategory, setFilterCategory] = useState<FeedbackCategory | "all">("all");
  const [filterSeverity, setFilterSeverity] = useState<FeedbackSeverity | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [pendingStatus, setPendingStatus] = useState<FeedbackStatus | null>(null);
  const [pendingSeverity, setPendingSeverity] = useState<FeedbackSeverity | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const selected = complaints.find((c) => c.id === selectedId) ?? null;

  const load = () => {
    fetch("/api/admin/feedback")
      .then((r) => r.json())
      .then((d) => setComplaints(Array.isArray(d.complaints) ? d.complaints : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = complaints.filter(
    (c) =>
      (filterStatus === "all" || c.status === filterStatus) &&
      (filterCategory === "all" || c.category === filterCategory) &&
      (filterSeverity === "all" || c.severity === filterSeverity),
  );

  const openDetail = (c: Complaint) => {
    setSelectedId(c.id);
    setReplyText("");
    setPendingStatus(c.status);
    setPendingSeverity(c.severity);
  };

  const closeDetail = () => setSelectedId(null);

  // Status/severity save is now SEPARATE from replying (postStaffMessage,
  // below) — the old single adminReply field is gone (docs §10), so this
  // only ever touches status/severity.
  const save = async () => {
    if (!selected) return;
    const body: { status?: FeedbackStatus; severity?: FeedbackSeverity } = {};
    if (pendingStatus && pendingStatus !== selected.status) body.status = pendingStatus;
    if (pendingSeverity && pendingSeverity !== selected.severity) body.severity = pendingSeverity;
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/feedback/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || "Failed to save");
        return;
      }
      load();
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async () => {
    const trimmed = replyText.trim();
    if (!selected || !trimmed) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/feedback/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Failed to send reply");
        return;
      }
      setComplaints((prev) => prev.map((c) => (c.id === selected.id ? { ...c, messages: [...c.messages, data.message] } : c)));
      setReplyText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MessageSquareWarning size={22} color="var(--accent-primary)" />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
            {tt("adminVocFeedback", "Feedback & Complaints")}
          </h1>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 10, padding: 10, borderRadius: 12, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.18)" }}>
        <ShieldOff size={16} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
          {tt(
            "feedbackAdminNoSubmitterNotice",
            "Submitter identity is not stored in a way this app can show — not to this view, not to super_admin, not to anyone. There is no \"who sent this\" field anywhere in the system.",
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: 16 }}>
        <select className="input" style={{ width: "auto", height: 36, fontSize: 13 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as FeedbackStatus | "all")}>
          <option value="all">{tt("feedbackAdminFilterAll", "All statuses")}</option>
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>{tt(FEEDBACK_STATUS_META[s].i18nKey, FEEDBACK_STATUS_META[s].fallback)}</option>
          ))}
        </select>
        <select className="input" style={{ width: "auto", height: 36, fontSize: 13 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as FeedbackCategory | "all")}>
          <option value="all">{tt("feedbackAdminFilterCategoryAll", "All categories")}</option>
          {FEEDBACK_CATEGORIES.map((c) => (
            <option key={c} value={c}>{tt(categoryMeta(c).i18nKey, categoryMeta(c).fallback)}</option>
          ))}
        </select>
        <select className="input" style={{ width: "auto", height: 36, fontSize: 13 }} value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value as FeedbackSeverity | "all")}>
          <option value="all">{tt("feedbackAdminFilterSeverityAll", "All severities")}</option>
          {FEEDBACK_SEVERITIES.map((s) => (
            <option key={s} value={s}>{tt(FEEDBACK_SEVERITY_META[s].i18nKey, FEEDBACK_SEVERITY_META[s].fallback)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={24} className="animate-spin" color="var(--text-muted)" />
        </div>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", padding: 24, textAlign: "center" }}>
          {tt("feedbackAdminEmpty", "Nothing here.")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((c) => {
            const cat = categoryMeta(c.category);
            const statusMeta = FEEDBACK_STATUS_META[c.status];
            const severityMeta = FEEDBACK_SEVERITY_META[c.severity];
            const Icon = cat.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openDetail(c)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left", cursor: "pointer",
                  padding: 14, borderRadius: 12, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
                }}
              >
                <Icon size={18} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{tt(cat.i18nKey, cat.fallback)}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, color: severityMeta.color, background: severityMeta.bg }}>
                      {tt(severityMeta.i18nKey, severityMeta.fallback)}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, color: statusMeta.color, background: statusMeta.bg }}>
                      {tt(statusMeta.i18nKey, statusMeta.fallback)}
                    </span>
                    {c.messages.length > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)" }}>
                        {c.messages.length} {tt("feedbackAdminMessagesCount", "messages")}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {c.message}
                  </p>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          // Centered dialog on both axes (matches AppealsClient's resolve
          // modal convention) — the previous alignItems:"flex-end" bottom
          // sheet read as "stuck to the bottom, not centered" on desktop.
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
          onClick={closeDetail}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", background: "var(--bg-elevated)", borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>
                {(() => { const Icon = categoryMeta(selected.category).icon; return <Icon size={18} />; })()}
                {tt(categoryMeta(selected.category).i18nKey, categoryMeta(selected.category).fallback)}
              </span>
              <button type="button" onClick={closeDetail} className="btn btn-ghost btn-sm" style={{ padding: 6 }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, margin: 0 }}>{selected.message}</p>

            {selected.contactOptIn && selected.contactInfo && (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {tt("feedbackAdminContactInfo", "Follow-up contact volunteered: ")}
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{selected.contactInfo}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2" style={{ alignItems: "flex-end" }}>
              <div>
                <label className="label" style={{ fontSize: 11 }}>{tt("feedbackAdminStatusLabel", "Status")}</label>
                <select className="input" style={{ height: 36, fontSize: 13 }} value={pendingStatus ?? selected.status} onChange={(e) => setPendingStatus(e.target.value as FeedbackStatus)}>
                  {FEEDBACK_STATUSES.map((s) => (
                    <option key={s} value={s}>{tt(FEEDBACK_STATUS_META[s].i18nKey, FEEDBACK_STATUS_META[s].fallback)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" style={{ fontSize: 11 }}>{tt("feedbackAdminSeverityLabel", "Severity")}</label>
                <select className="input" style={{ height: 36, fontSize: 13 }} value={pendingSeverity ?? selected.severity} onChange={(e) => setPendingSeverity(e.target.value as FeedbackSeverity)}>
                  {FEEDBACK_SEVERITIES.map((s) => (
                    <option key={s} value={s}>{tt(FEEDBACK_SEVERITY_META[s].i18nKey, FEEDBACK_SEVERITY_META[s].fallback)}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={saving || (pendingStatus === selected.status && pendingSeverity === selected.severity)}
                onClick={save}
              >
                {saving ? tt("saving", "Saving…") : tt("feedbackAdminSave", "Save")}
              </button>
            </div>

            {selected.messages.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                  {tt("feedbackAdminConversationLabel", "Conversation")}
                </p>
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.senderType === "staff" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      padding: "8px 12px",
                      borderRadius: 12,
                      background: m.senderType === "staff" ? "var(--accent-primary)" : "var(--bg-surface)",
                      color: m.senderType === "staff" ? "#fff" : "var(--text-primary)",
                    }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, margin: "0 0 2px", textTransform: "uppercase" }}>
                      {m.senderType === "staff" ? tt("feedbackAdminStaffLabel", "Staff") : tt("feedbackAdminSubmitterLabel", "Submitter")}
                    </p>
                    <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5, margin: 0 }}>{m.body}</p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ borderTop: selected.messages.length === 0 ? "1px solid var(--border-subtle)" : undefined, paddingTop: selected.messages.length === 0 ? 12 : 0 }}>
              <label className="label" style={{ display: "block", marginBottom: 6 }}>{tt("feedbackAdminReplyLabel", "Reply (visible to the submitter under My Feedback)")}</label>
              <textarea
                className="input"
                rows={3}
                placeholder={tt("feedbackAdminReplyPlaceholder", "Write a reply the submitter will see…")}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                style={{ resize: "vertical" }}
              />
              <button
                type="button"
                className="btn btn-primary btn-full"
                disabled={sending || !replyText.trim()}
                onClick={sendReply}
                style={{ height: 44, borderRadius: 12, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? tt("submitting", "Sending…") : tt("feedbackAdminSendReply", "Send")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
