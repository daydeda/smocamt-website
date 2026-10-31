"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  FEEDBACK_SEVERITY_META,
  FEEDBACK_STATUS_META,
  categoryMeta,
} from "@/lib/feedback/feedback-ui";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackSeverity,
  type FeedbackStatus,
} from "@/lib/feedback/feedback-token";
import {
  EmptyState,
  ErrorState,
  Field,
  InlineAlert,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  TabPanel,
  Tabs,
  Toolbar,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/admin/ui";

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

const SEVERITY_TONE: Record<FeedbackSeverity, Tone> = { low: "neutral", normal: "info", urgent: "danger" };
const STATUS_TONE: Record<FeedbackStatus, Tone> = { new: "info", in_review: "warning", resolved: "success", closed: "neutral" };

export function FeedbackAdminClient() {
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const tr = t as Record<string, string>;
  const tt = (key: string, fallback: string) => tr[key] || fallback;

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
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

  // `showSpinner` is true for an explicit retry; a refresh after saving
  // updates the list in place without flashing the loading state.
  const load = useCallback((showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
      setFailed(false);
    }
    fetch("/api/admin/feedback")
      .then((r) => r.json())
      .then((d) => setComplaints(Array.isArray(d.complaints) ? d.complaints : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred so state updates happen outside the synchronous effect body.
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const matchesOther = (c: Complaint) =>
    (filterCategory === "all" || c.category === filterCategory) &&
    (filterSeverity === "all" || c.severity === filterSeverity);

  const filtered = complaints.filter((c) => matchesOther(c) && (filterStatus === "all" || c.status === filterStatus));

  const statusTabs: { id: FeedbackStatus | "all"; label: string; count: number }[] = [
    ...FEEDBACK_STATUSES.map((s) => ({
      id: s as FeedbackStatus | "all",
      label: tt(FEEDBACK_STATUS_META[s].i18nKey, FEEDBACK_STATUS_META[s].fallback),
      count: complaints.filter((c) => matchesOther(c) && c.status === s).length,
    })),
    { id: "all", label: tt("feedbackAdminFilterAll", "All statuses"), count: complaints.filter(matchesOther).length },
  ];

  const openDetail = (c: Complaint) => {
    setSelectedId(c.id);
    setReplyText("");
    setPendingStatus(c.status);
    setPendingSeverity(c.severity);
  };

  const closeDetail = async () => {
    if (saving || sending) return;
    // An unsent reply would be lost silently, so ask first.
    if (replyText.trim()) {
      const discard = await confirm({
        title: t.adminOvFbDiscardTitle,
        message: t.adminOvFbDiscardBody,
        confirmLabel: t.adminOvFbDiscard,
        tone: "danger",
      });
      if (!discard) return;
    }
    setSelectedId(null);
  };

  // Status/severity save is now SEPARATE from replying (postStaffMessage,
  // below) — the old single adminReply field is gone (docs §10), so this
  // only ever touches status/severity.
  const save = async () => {
    if (!selected || saving) return;
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
        toast.error(t.adminOvFbSaveFailed, d?.error || t.adminUiErrorBody);
        return;
      }
      toast.success(t.adminOvFbSaved);
      load();
    } catch {
      toast.error(t.adminOvFbSaveFailed, t.adminUiErrorBody);
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async () => {
    const trimmed = replyText.trim();
    if (!selected || !trimmed || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/feedback/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t.adminOvFbReplyFailed, data?.error || t.adminUiErrorBody);
        return;
      }
      setComplaints((prev) => prev.map((c) => (c.id === selected.id ? { ...c, messages: [...c.messages, data.message] } : c)));
      setReplyText("");
      toast.success(t.adminOvFbReplySent);
    } catch {
      toast.error(t.adminOvFbReplyFailed, t.adminUiErrorBody);
    } finally {
      setSending(false);
    }
  };

  const optionLabel = (meta: { i18nKey: string; fallback: string }) => tt(meta.i18nKey, meta.fallback);
  const unchanged = !selected || (pendingStatus === selected.status && pendingSeverity === selected.severity);
  const SelectedIcon = selected ? categoryMeta(selected.category).icon : null;

  return (
    <div className="pb-20">
      <PageHeader title={tt("adminVocFeedback", "Feedback & Complaints")} description={t.adminOvFbDesc} />

      <div style={{ marginBottom: 20 }}>
        <InlineAlert tone="info">
          {tt(
            "feedbackAdminNoSubmitterNotice",
            "Submitter identity is not stored in a way this app can show — not to this view, not to super_admin, not to anyone. There is no \"who sent this\" field anywhere in the system.",
          )}
        </InlineAlert>
      </div>

      {loading ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : failed ? (
        <ErrorState onRetry={() => load(true)} />
      ) : (
        <>
          <Tabs
            idBase="feedback"
            ariaLabel={tt("feedbackAdminStatusLabel", "Status")}
            value={filterStatus}
            onChange={setFilterStatus}
            tabs={statusTabs}
          />

          <Toolbar>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
              {t.adminOvFbCategory}
              <select className="input" style={{ width: "auto" }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as FeedbackCategory | "all")}>
                <option value="all">{tt("feedbackAdminFilterCategoryAll", "All categories")}</option>
                {FEEDBACK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{optionLabel(categoryMeta(c))}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
              {tt("feedbackAdminSeverityLabel", "Severity")}
              <select className="input" style={{ width: "auto" }} value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value as FeedbackSeverity | "all")}>
                <option value="all">{tt("feedbackAdminFilterSeverityAll", "All severities")}</option>
                {FEEDBACK_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{optionLabel(FEEDBACK_SEVERITY_META[s])}</option>
                ))}
              </select>
            </label>
          </Toolbar>

          <TabPanel idBase="feedback" id={filterStatus}>
            {filtered.length === 0 ? (
              <EmptyState title={tt("feedbackAdminEmpty", "Nothing here.")} description={t.adminOvFbEmptyDesc} />
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map((c) => {
                  const cat = categoryMeta(c.category);
                  const Icon = cat.icon;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openDetail(c)}
                        className="adm-stat adm-stat-link"
                        style={{ width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 12, textAlign: "left", cursor: "pointer", font: "inherit" }}
                      >
                        <Icon size={20} aria-hidden="true" color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{optionLabel(cat)}</span>
                            <StatusBadge tone={SEVERITY_TONE[c.severity]}>{optionLabel(FEEDBACK_SEVERITY_META[c.severity])}</StatusBadge>
                            <StatusBadge tone={STATUS_TONE[c.status]}>{optionLabel(FEEDBACK_STATUS_META[c.status])}</StatusBadge>
                            {c.messages.length > 0 && (
                              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                {c.messages.length} {tt("feedbackAdminMessagesCount", "messages")}
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                            {c.message}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{new Date(c.createdAt).toLocaleString()}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabPanel>
        </>
      )}

      {selected && SelectedIcon && (
        <Modal
          open
          onClose={closeDetail}
          size="md"
          dismissible={!saving && !sending}
          icon={<SelectedIcon size={20} />}
          title={optionLabel(categoryMeta(selected.category))}
          description={new Date(selected.createdAt).toLocaleString()}
          footer={
            <button type="button" className="btn btn-ghost" onClick={closeDetail} disabled={saving || sending}>
              {t.adminUiClose}
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <p style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, overflowWrap: "anywhere" }}>{selected.message}</p>

            {selected.contactOptIn && selected.contactInfo && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {tt("feedbackAdminContactInfo", "Follow-up contact volunteered: ")}
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{selected.contactInfo}</span>
              </p>
            )}

            <div className="flex flex-wrap gap-3" style={{ alignItems: "flex-end" }}>
              <Field label={tt("feedbackAdminStatusLabel", "Status")}>
                {(p) => (
                  <select {...p} className="input" disabled={saving} value={pendingStatus ?? selected.status} onChange={(e) => setPendingStatus(e.target.value as FeedbackStatus)}>
                    {FEEDBACK_STATUSES.map((s) => (
                      <option key={s} value={s}>{optionLabel(FEEDBACK_STATUS_META[s])}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={tt("feedbackAdminSeverityLabel", "Severity")}>
                {(p) => (
                  <select {...p} className="input" disabled={saving} value={pendingSeverity ?? selected.severity} onChange={(e) => setPendingSeverity(e.target.value as FeedbackSeverity)}>
                    {FEEDBACK_SEVERITIES.map((s) => (
                      <option key={s} value={s}>{optionLabel(FEEDBACK_SEVERITY_META[s])}</option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="button" className="btn btn-ghost" disabled={saving || unchanged} onClick={save}>
                {saving ? tt("saving", "Saving…") : tt("feedbackAdminSave", "Save")}
              </button>
            </div>

            {selected.messages.length > 0 && (
              <section aria-label={tt("feedbackAdminConversationLabel", "Conversation")} style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
                  {tt("feedbackAdminConversationLabel", "Conversation")}
                </h3>
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.senderType === "staff" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      padding: "8px 12px",
                      borderRadius: 12,
                      background: m.senderType === "staff" ? "var(--accent-primary)" : "var(--bg-elevated)",
                      color: m.senderType === "staff" ? "var(--text-on-color)" : "var(--text-primary)",
                    }}
                  >
                    <p style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, marginBottom: 2 }}>
                      {m.senderType === "staff" ? tt("feedbackAdminStaffLabel", "Staff") : tt("feedbackAdminSubmitterLabel", "Submitter")}
                    </p>
                    <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" }}>{m.body}</p>
                  </div>
                ))}
              </section>
            )}

            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <Field label={tt("feedbackAdminReplyLabel", "Reply (visible to the submitter under My Feedback)")}>
                {(p) => (
                  <textarea
                    {...p}
                    className="input"
                    rows={3}
                    placeholder={tt("feedbackAdminReplyPlaceholder", "Write a reply the submitter will see…")}
                    value={replyText}
                    disabled={sending}
                    onChange={(e) => setReplyText(e.target.value)}
                    style={{ resize: "vertical" }}
                  />
                )}
              </Field>
              <button
                type="button"
                className="btn btn-primary"
                disabled={sending || !replyText.trim()}
                onClick={sendReply}
                style={{ alignSelf: "flex-end", gap: 8 }}
              >
                {sending ? <div className="spinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                {sending ? tt("submitting", "Sending…") : tt("feedbackAdminSendReply", "Send")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
