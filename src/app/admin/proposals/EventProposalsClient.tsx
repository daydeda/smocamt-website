"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, CheckCircle2, XCircle, Loader2, Clock, Building2, UserCheck } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { parseRichText } from "@/lib/rich-text";

type Proposal = {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  registrationOpenTime: string | null;
  registrationCloseTime: string | null;
  location: string | null;
  quota: number | null;
  imageUrl: string | null;
  imageUrls: string[] | null;
  walkInsEnabled: boolean | null;
  walkInsOnly: boolean | null;
  quotaWalkIn: number | null;
  targetThai: boolean | null;
  targetInternational: boolean | null;
  quotaThai: number | null;
  quotaInternational: number | null;
  firstYearOnly: boolean | null;
  staffUserIds: string[] | null;
  allowedRoles: string[] | null;
  allowedMajors: string[] | null;
  allowedClubs: string[] | null;
  sessions: { title: string | null; startTime: string; endTime: string }[] | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  // Exactly one of club/majorCode is set — a club_president proposal carries
  // club, a major_president proposal carries majorCode instead (club is null).
  // See eventProposals.clubId/majorCode in schema.ts.
  club: { id: string; name: string } | null;
  majorCode: string | null;
  proposer: { id: string; name: string; studentId: string | null };
  reviewer: { id: string; name: string } | null;
};

const FILTERS = ["pending", "approved", "rejected", "withdrawn", "all"] as const;
type Filter = (typeof FILTERS)[number];

export function EventProposalsClient() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<Proposal | null>(null);
  const [reason, setReason] = useState("");

  const STATUS_BADGE: Record<Proposal["status"], { bg: string; color: string; label: string }> = {
    pending: { bg: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-500)", label: t.adminProposalsFilterPending },
    approved: { bg: "rgb(var(--green-500-rgb) / 0.1)", color: "var(--green-500)", label: t.adminProposalsFilterApproved },
    rejected: { bg: "rgb(var(--red-500-rgb) / 0.1)", color: "var(--red-500)", label: t.adminProposalsFilterRejected },
    withdrawn: { bg: "rgb(var(--slate-400-rgb) / 0.15)", color: "var(--slate-500)", label: t.adminProposalsFilterWithdrawn },
  };

  const FILTER_LABEL: Record<Filter, string> = {
    pending: t.adminProposalsFilterPending,
    approved: t.adminProposalsFilterApproved,
    rejected: t.adminProposalsFilterRejected,
    withdrawn: t.adminProposalsFilterWithdrawn,
    all: t.adminProposalsFilterAll,
  };

  const load = () => {
    fetch("/api/admin/event-proposals")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setProposals(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openRejectModal = (p: Proposal) => {
    setReason("");
    setRejectModal(p);
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    const id = rejectModal.id;
    const note = reason.trim() || undefined;
    setRejectModal(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/event-proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reviewNote: note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || "Failed to reject proposal");
        return;
      }
      load();
    } finally {
      setBusyId(null);
    }
  };

  const createEventFrom = (p: Proposal) => {
    router.push(`/admin/events?fromProposal=${p.id}`);
  };

  const filtered = filter === "all" ? proposals : proposals.filter((p) => p.status === filter);

  return (
    <div className="pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 12 }}>
          <ClipboardList size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
          {t.adminProposalsPageTitle}
        </h1>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="btn btn-sm"
            style={{
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 12,
              background: filter === f ? "var(--accent-primary)" : "var(--bg-surface)",
              color: filter === f ? "var(--text-on-color)" : "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
          {t.adminProposalsReviewEmptyMessage}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((p) => {
            const badge = STATUS_BADGE[p.status];
            const poster = p.imageUrls?.[0] || p.imageUrl;
            return (
              <div key={p.id} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    {poster && (
                      <img src={poster} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                    )}
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 15 }}>{p.title}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                        <Building2 size={12} /> {p.club ? p.club.name : (lang === "th" ? `สาขา ${p.majorCode}` : `Major: ${p.majorCode}`)}
                        <span> · {t.adminProposalsRequestedByLabel} {p.proposer.name}{p.proposer.studentId ? ` (${p.proposer.studentId})` : ""}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={11} /> {new Date(p.createdAt).toLocaleString("en-GB")}</span>
                      </p>
                    </div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: badge.bg, color: badge.color, height: "fit-content" }}>
                    {badge.label}
                  </span>
                </div>

                <div style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "10px 12px", borderRadius: 8 }}>
                  <p>{new Date(p.startTime).toLocaleString("en-GB")} – {new Date(p.endTime).toLocaleString("en-GB")}</p>
                  {(p.registrationOpenTime || p.registrationCloseTime) && (
                    <p style={{ marginTop: 4 }}>
                      {t.eventRegistrationOpenLabel}: {p.registrationOpenTime ? new Date(p.registrationOpenTime).toLocaleString("en-GB") : "—"}
                      {" · "}
                      {t.eventRegistrationCloseLabel}: {p.registrationCloseTime ? new Date(p.registrationCloseTime).toLocaleString("en-GB") : "—"}
                    </p>
                  )}
                  {p.location && <p style={{ marginTop: 4 }}>{p.location}</p>}
                  {p.quota != null && <p style={{ marginTop: 4 }}>Quota: {p.quota}</p>}
                  {p.description && (
                    <div style={{ marginTop: 4, overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: parseRichText(p.description) }} />
                  )}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {p.sessions && p.sessions.length > 1 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      {p.sessions.length} {lang === "th" ? "วัน" : "days"}
                    </span>
                  )}
                  {p.walkInsOnly ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      {t.walkInsOnlyBadge}
                    </span>
                  ) : p.walkInsEnabled && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      {t.allowWalkins}{p.quotaWalkIn != null ? ` (${p.quotaWalkIn})` : ""}
                    </span>
                  )}
                  {p.firstYearOnly && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      {t.firstYearOnly}
                    </span>
                  )}
                  {(p.targetThai === false || p.targetInternational === false) && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      {[p.targetThai ? t.thaiStudents : null, p.targetInternational ? t.internationalStudents : null].filter(Boolean).join(" + ") || t.targetAudience}
                    </span>
                  )}
                  {p.staffUserIds && p.staffUserIds.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      {p.staffUserIds.length} {lang === "th" ? "ทีมงานที่เสนอ" : "suggested staff"}
                    </span>
                  )}
                  {/* Suggested-access ACL — non-binding, staff sets the real
                      allowedRoles/allowedMajors/allowedClubs when creating the
                      event (see the fromProposal prefill in admin/events/page.tsx). */}
                  {p.allowedRoles && p.allowedRoles.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "rgb(var(--indigo-500-rgb) / 0.1)", color: "var(--indigo-500)" }}>
                      {lang === "th" ? "แนะนำตามบทบาท: " : lang === "cn" ? "建议角色： " : lang === "mm" ? "အကြံပြုအခန်းကဏ္ဍ: " : "Suggested roles: "}{p.allowedRoles.join(", ")}
                    </span>
                  )}
                  {p.allowedMajors && p.allowedMajors.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "rgb(var(--accent-rgb) / 0.1)", color: "var(--accent-primary)" }}>
                      {lang === "th" ? "แนะนำตามสาขา: " : lang === "cn" ? "建议专业： " : lang === "mm" ? "အကြံပြုအထူးပြုဌာန: " : "Suggested majors: "}{p.allowedMajors.join(", ")}
                    </span>
                  )}
                  {p.allowedClubs && p.allowedClubs.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "rgb(var(--violet-500-rgb) / 0.1)", color: "var(--violet-500)" }}>
                      {p.allowedClubs.length} {lang === "th" ? "ชมรมที่แนะนำ" : lang === "cn" ? "个建议社团" : lang === "mm" ? "အကြံပြုကလပ်" : "suggested clubs"}
                    </span>
                  )}
                </div>

                {p.reviewNote && (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>{p.reviewNote}</p>
                )}

                {p.status !== "pending" && p.reviewer && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                    <UserCheck size={12} />
                    {t.adminProposalsReviewedByLabel} {p.reviewer.name}
                    {p.reviewedAt && ` · ${new Date(p.reviewedAt).toLocaleString("en-GB")}`}
                  </p>
                )}

                {p.status === "pending" && (
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button
                      onClick={() => openRejectModal(p)}
                      disabled={busyId === p.id}
                      className="btn btn-ghost"
                      style={{ flex: 1, color: "var(--red-500)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <XCircle size={16} /> {t.adminProposalsRejectButton}
                    </button>
                    <button
                      onClick={() => createEventFrom(p)}
                      disabled={busyId === p.id}
                      className="btn btn-primary"
                      style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      {busyId === p.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      {t.adminProposalsCreateEventButton}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rejectModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgb(var(--scrim-rgb) / 0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
          onClick={() => setRejectModal(null)}
        >
          <div
            style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", padding: 24, maxWidth: 440, width: "100%", border: "1px solid var(--border-subtle)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t.adminProposalsRejectModalTitle}</h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 14, overflowWrap: "anywhere" }}>
              {t.adminProposalsRejectModalDescription}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.adminProposalsRejectPlaceholder}
              maxLength={1000}
              rows={3}
              style={{
                width: "100%",
                resize: "vertical",
                background: "var(--bg-base)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                color: "var(--text-primary)",
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setRejectModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                {t.adminProposalsCancelButton}
              </button>
              <button onClick={confirmReject} className="btn btn-primary" style={{ flex: 1, background: "var(--red-500)" }}>
                {t.adminProposalsConfirmButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
