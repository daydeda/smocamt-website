"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MessageSquareWarning, CheckCircle2, XCircle, Loader2, Clock, UserCheck, CalendarX2 } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { effectiveRoles } from "@/lib/admin-access";
import { canonicalHouseName } from "@/lib/faculties";
import { NO_SHOW_STRIKE_THRESHOLD, RESOLVE_APPEALS_ROLES } from "@/lib/strikes";

type Appeal = {
  id: string;
  message: string;
  noShowCountAtAppeal: number;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  event: { id: string; title: string; endTime: string } | null;
  user: {
    id: string;
    name: string;
    studentId: string | null;
    noShowCount: number;
    registrationBlocked: boolean;
    house: { id: string; name: string; color?: string | null } | null;
  };
  reviewer: { id: string; name: string } | null;
};

const FILTERS = ["pending", "approved", "rejected", "all"] as const;
type Filter = (typeof FILTERS)[number];

const PAGE_SIZE = 10;

export function AppealsClient() {
  const { t } = useLanguage();
  const { data: session } = useSession();
  // smo can view this queue (VIEW_APPEALS_ROLES) but not resolve appeals; the
  // server independently re-checks RESOLVE_APPEALS_ROLES + event ownership on
  // PATCH — this is UI-only, not the source of truth.
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const canResolve = myRoles.some((r) => (RESOLVE_APPEALS_ROLES as readonly string[]).includes(r));
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("pending");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolveModal, setResolveModal] = useState<{ appeal: Appeal; action: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");

  const STATUS_BADGE: Record<Appeal["status"], { bg: string; color: string; label: string }> = {
    pending: { bg: "rgba(245,158,11,0.1)", color: "#f59e0b", label: t.adminAppealsFilterPending },
    approved: { bg: "rgba(34,197,94,0.1)", color: "#22c55e", label: t.adminAppealsFilterApproved },
    rejected: { bg: "rgba(239,68,68,0.1)", color: "#ef4444", label: t.adminAppealsFilterRejected },
  };

  const FILTER_LABEL: Record<Filter, string> = {
    pending: t.adminAppealsFilterPending,
    approved: t.adminAppealsFilterApproved,
    rejected: t.adminAppealsFilterRejected,
    all: t.adminAppealsFilterAll,
  };

  // loading starts true (initial state) so the first fetch doesn't need a
  // synchronous setState inside the effect (flagged by react-hooks/set-state-in-effect).
  const load = () => {
    fetch("/api/admin/appeals")
      .then((r) => r.json())
      .then((d) => setAppeals(Array.isArray(d.appeals) ? d.appeals : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openResolveModal = (appeal: Appeal, action: "approve" | "reject") => {
    setReason("");
    setResolveModal({ appeal, action });
  };

  const confirmResolve = async () => {
    if (!resolveModal) return;
    const { appeal, action } = resolveModal;
    const note = reason.trim() || undefined;

    setResolveModal(null);
    setBusyId(appeal.id);
    try {
      const res = await fetch(`/api/admin/appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || "Failed to resolve appeal");
        return;
      }
      load();
    } finally {
      setBusyId(null);
    }
  };

  const filtered = filter === "all" ? appeals : appeals.filter((a) => a.status === filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const changeFilter = (f: Filter) => {
    setFilter(f);
    setPage(1);
  };

  return (
    <div className="pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 12 }}>
          <MessageSquareWarning size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
          {t.adminAppealsTitle}
        </h1>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => changeFilter(f)}
            className="btn btn-sm"
            style={{
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 12,
              background: filter === f ? "var(--accent-primary)" : "var(--bg-surface)",
              color: filter === f ? "#fff" : "var(--text-secondary)",
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
          {t.adminAppealsEmptyMessage}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pageItems.map((a) => {
            const badge = STATUS_BADGE[a.status];
            return (
              <div key={a.id} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 15 }}>
                      {a.user.name}
                      {a.user.house && <span style={{ color: a.user.house.color ?? "var(--text-muted)", fontWeight: 600, fontSize: 12 }}> · {canonicalHouseName(a.user.house)}</span>}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                      {a.user.studentId ?? "—"} · {t.adminAppealsStrikesAtAppeal} {a.noShowCountAtAppeal}/{NO_SHOW_STRIKE_THRESHOLD}
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={11} /> {new Date(a.createdAt).toLocaleString("en-GB")}</span>
                    </p>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: badge.bg, color: badge.color, height: "fit-content" }}>
                    {badge.label}
                  </span>
                </div>

                {a.event && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 10 }}>
                    <CalendarX2 size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span style={{ overflowWrap: "anywhere" }}>
                      {t.adminAppealsEventLabel} {a.event.title}
                    </span>
                  </p>
                )}

                <p style={{ fontSize: 14, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "10px 12px", borderRadius: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {a.message}
                </p>

                {a.reviewNote && (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
                    {t.appealStaffNoteLabel} {a.reviewNote}
                  </p>
                )}

                {a.status !== "pending" && a.reviewer && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                    <UserCheck size={12} />
                    {t.adminAppealsReviewedByLabel} {a.reviewer.name}
                    {a.reviewedAt && ` · ${new Date(a.reviewedAt).toLocaleString("en-GB")}`}
                  </p>
                )}

                {a.status === "pending" && canResolve && (
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button
                      onClick={() => openResolveModal(a, "reject")}
                      disabled={busyId === a.id}
                      className="btn btn-ghost"
                      style={{ flex: 1, color: "#ef4444", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <XCircle size={16} /> {t.adminAppealsRejectButton}
                    </button>
                    <button
                      onClick={() => openResolveModal(a, "approve")}
                      disabled={busyId === a.id}
                      className="btn btn-primary"
                      style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      {busyId === a.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      {t.adminAppealsApproveButton}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginTop: 20 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
            {t.adminAppealsShowingRange
              .replace("{from}", String((currentPage - 1) * PAGE_SIZE + 1))
              .replace("{to}", String(Math.min(currentPage * PAGE_SIZE, filtered.length)))
              .replace("{total}", String(filtered.length))}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: "8px 16px", borderRadius: 10, fontWeight: 700 }}
              disabled={currentPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t.adminAppealsPrevious}
            </button>
            <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 800 }}>
              {t.adminAppealsPageOf.replace("{page}", String(currentPage)).replace("{total}", String(totalPages))}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: "8px 16px", borderRadius: 10, fontWeight: 700 }}
              disabled={currentPage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t.adminAppealsNext}
            </button>
          </div>
        </div>
      )}

      {resolveModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
          onClick={() => setResolveModal(null)}
        >
          <div
            style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", padding: 24, maxWidth: 440, width: "100%", border: "1px solid var(--border-subtle)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
              {resolveModal.action === "approve" ? t.adminAppealsApproveConfirmTitle : t.adminAppealsRejectModalTitle}
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 14, overflowWrap: "anywhere" }}>
              {resolveModal.action === "approve"
                ? t.adminAppealsApproveConfirmMessage
                    .replace("{name}", resolveModal.appeal.user.name)
                    .replace("{event}", resolveModal.appeal.event?.title ?? "")
                    .replace("{before}", String(resolveModal.appeal.user.noShowCount))
                    .replace("{after}", String(Math.max(0, resolveModal.appeal.user.noShowCount - 1)))
                    .replaceAll("{max}", String(NO_SHOW_STRIKE_THRESHOLD))
                : t.adminAppealsRejectModalDescription.replace("{name}", resolveModal.appeal.user.name)}
            </p>
            {resolveModal.action === "reject" && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t.adminAppealsRejectPlaceholder}
                maxLength={500}
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
            )}
            <div style={{ display: "flex", gap: 10, marginTop: resolveModal.action === "approve" ? 16 : 0 }}>
              <button onClick={() => setResolveModal(null)} className="btn btn-ghost" style={{ flex: 1 }}>
                {t.appealCancelButton}
              </button>
              <button
                onClick={confirmResolve}
                className="btn btn-primary"
                style={{
                  flex: 1,
                  background: resolveModal.action === "reject" ? "#ef4444" : undefined,
                }}
              >
                {t.adminAppealsConfirmButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
