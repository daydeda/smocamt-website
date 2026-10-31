"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { CalendarX2, CheckCircle2, ChevronLeft, ChevronRight, Clock, UserCheck, XCircle } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { effectiveRoles } from "@/lib/access/admin-access";
import { canonicalHouseName } from "@/lib/profile/faculties";
import { NO_SHOW_STRIKE_THRESHOLD, RESOLVE_APPEALS_ROLES } from "@/lib/points/strikes";
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
  TabPanel,
  Tabs,
  useToast,
  type Tone,
} from "@/components/admin/ui";

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

const STATUS_TONE: Record<Appeal["status"], Tone> = { pending: "warning", approved: "success", rejected: "danger" };

export function AppealsClient() {
  const { t } = useLanguage();
  const toast = useToast();
  const { data: session } = useSession();
  // smo can view this queue (VIEW_APPEALS_ROLES) but not resolve appeals; the
  // server independently re-checks RESOLVE_APPEALS_ROLES + event ownership on
  // PATCH — this is UI-only, not the source of truth.
  const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const canResolve = myRoles.some((r) => (RESOLVE_APPEALS_ROLES as readonly string[]).includes(r));
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("pending");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolveModal, setResolveModal] = useState<{ appeal: Appeal; action: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");

  const STATUS_LABEL: Record<Appeal["status"], string> = {
    pending: t.adminAppealsFilterPending,
    approved: t.adminAppealsFilterApproved,
    rejected: t.adminAppealsFilterRejected,
  };

  const FILTER_LABEL: Record<Filter, string> = {
    pending: t.adminAppealsFilterPending,
    approved: t.adminAppealsFilterApproved,
    rejected: t.adminAppealsFilterRejected,
    all: t.adminAppealsFilterAll,
  };

  // `showSpinner` is true for an explicit retry; a refresh after resolving an
  // appeal updates the list in place without flashing the loading state.
  const load = useCallback((showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
      setFailed(false);
    }
    fetch("/api/admin/appeals")
      .then((r) => r.json())
      .then((d) => setAppeals(Array.isArray(d.appeals) ? d.appeals : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred so state updates happen outside the synchronous effect body.
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openResolveModal = (appeal: Appeal, action: "approve" | "reject") => {
    setReason("");
    setResolveModal({ appeal, action });
  };

  const closeResolveModal = () => {
    if (busyId) return;
    setResolveModal(null);
  };

  const confirmResolve = async () => {
    if (!resolveModal || busyId) return;
    const { appeal, action } = resolveModal;
    const note = reason.trim() || undefined;

    setBusyId(appeal.id);
    try {
      const res = await fetch(`/api/admin/appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(t.adminOvAppealFailed, d?.error || t.adminUiErrorBody);
        return;
      }
      toast.success(action === "approve" ? t.adminOvAppealApproved : t.adminOvAppealRejected, appeal.user.name);
      setResolveModal(null);
      load();
    } catch {
      toast.error(t.adminOvAppealFailed, t.adminUiErrorBody);
    } finally {
      setBusyId(null);
    }
  };

  const countFor = (f: Filter) => (f === "all" ? appeals.length : appeals.filter((a) => a.status === f).length);
  const filtered = filter === "all" ? appeals : appeals.filter((a) => a.status === filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const changeFilter = (f: Filter) => {
    setFilter(f);
    setPage(1);
  };

  const approving = resolveModal?.action === "approve";

  return (
    <div className="pb-20">
      <PageHeader title={t.adminAppealsTitle} description={t.adminOvAppealsDesc} />

      {loading ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : failed ? (
        <ErrorState onRetry={() => load(true)} />
      ) : (
        <>
          <Tabs
            idBase="appeals"
            ariaLabel={t.adminAppealsTitle}
            value={filter}
            onChange={changeFilter}
            tabs={FILTERS.map((f) => ({ id: f, label: FILTER_LABEL[f], count: countFor(f) }))}
          />

          <TabPanel idBase="appeals" id={filter}>
            {filtered.length === 0 ? (
              <EmptyState title={t.adminAppealsEmptyMessage} description={t.adminOvAppealsEmptyDesc} />
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {pageItems.map((a) => (
                  <li key={a.id}>
                    <Panel>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4 }}>
                            {a.user.name}
                            {a.user.house && (
                              <span style={{ color: a.user.house.color ?? "var(--text-muted)", fontWeight: 600, fontSize: 13 }}> · {canonicalHouseName(a.user.house)}</span>
                            )}
                          </p>
                          <p style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "2px 10px", marginTop: 2, flexWrap: "wrap" }}>
                            <span>{a.user.studentId ?? "—"}</span>
                            <span>{t.adminAppealsStrikesAtAppeal} {a.noShowCountAtAppeal}/{NO_SHOW_STRIKE_THRESHOLD}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Clock size={12} aria-hidden="true" /> {new Date(a.createdAt).toLocaleString("en-GB")}
                            </span>
                          </p>
                        </div>
                        <div style={{ height: "fit-content" }}>
                          <StatusBadge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</StatusBadge>
                        </div>
                      </div>

                      {a.event && (
                        <p style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 10 }}>
                          <CalendarX2 size={14} aria-hidden="true" style={{ marginTop: 3, flexShrink: 0 }} />
                          <span style={{ overflowWrap: "anywhere" }}>
                            {t.adminAppealsEventLabel} {a.event.title}
                          </span>
                        </p>
                      )}

                      <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "10px 12px", borderRadius: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {a.message}
                      </p>

                      {a.reviewNote && (
                        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
                          {t.appealStaffNoteLabel} {a.reviewNote}
                        </p>
                      )}

                      {a.status !== "pending" && a.reviewer && (
                        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <UserCheck size={14} aria-hidden="true" />
                          {t.adminAppealsReviewedByLabel} {a.reviewer.name}
                          {a.reviewedAt && ` · ${new Date(a.reviewedAt).toLocaleString("en-GB")}`}
                        </p>
                      )}

                      {a.status === "pending" && canResolve && (
                        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => openResolveModal(a, "reject")}
                            disabled={busyId === a.id}
                            className="btn btn-ghost"
                            style={{ color: "var(--red-600)", gap: 6 }}
                          >
                            <XCircle size={16} aria-hidden="true" /> {t.adminAppealsRejectButton}
                          </button>
                          <button
                            type="button"
                            onClick={() => openResolveModal(a, "approve")}
                            disabled={busyId === a.id}
                            className="btn btn-primary"
                            style={{ gap: 6 }}
                          >
                            <CheckCircle2 size={16} aria-hidden="true" /> {t.adminAppealsApproveButton}
                          </button>
                        </div>
                      )}
                    </Panel>
                  </li>
                ))}
              </ul>
            )}

            {filtered.length > PAGE_SIZE && (
              <nav
                aria-label={t.adminOvPagination}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginTop: 20 }}
              >
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {t.adminAppealsShowingRange
                    .replace("{from}", String((currentPage - 1) * PAGE_SIZE + 1))
                    .replace("{to}", String(Math.min(currentPage * PAGE_SIZE, filtered.length)))
                    .replace("{total}", String(filtered.length))}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ gap: 4 }} disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft size={16} aria-hidden="true" />
                    {t.adminAppealsPrevious}
                  </button>
                  <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {t.adminAppealsPageOf.replace("{page}", String(currentPage)).replace("{total}", String(totalPages))}
                  </span>
                  <button type="button" className="btn btn-ghost" style={{ gap: 4 }} disabled={currentPage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    {t.adminAppealsNext}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </nav>
            )}
          </TabPanel>
        </>
      )}

      {resolveModal && (
        <Modal
          open
          onClose={closeResolveModal}
          size="sm"
          dismissible={!busyId}
          title={approving ? t.adminAppealsApproveConfirmTitle : t.adminAppealsRejectModalTitle}
          description={
            approving
              ? t.adminAppealsApproveConfirmMessage
                  .replace("{name}", resolveModal.appeal.user.name)
                  .replace("{event}", resolveModal.appeal.event?.title ?? "")
                  .replace("{before}", String(resolveModal.appeal.user.noShowCount))
                  .replace("{after}", String(Math.max(0, resolveModal.appeal.user.noShowCount - 1)))
                  .replaceAll("{max}", String(NO_SHOW_STRIKE_THRESHOLD))
              : t.adminAppealsRejectModalDescription.replace("{name}", resolveModal.appeal.user.name)
          }
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={closeResolveModal} disabled={!!busyId}>
                {t.appealCancelButton}
              </button>
              <button
                type="button"
                className={approving ? "btn btn-primary" : "btn adm-btn-danger-solid"}
                onClick={confirmResolve}
                disabled={!!busyId}
              >
                {busyId ? t.saving : approving ? t.adminAppealsApproveButton : t.adminAppealsRejectButton}
              </button>
            </>
          }
        >
          {approving ? null : (
            <Field label={t.adminOvNoteLabel} hint={t.adminOvNoteHint}>
              {(p) => (
                <textarea
                  {...p}
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t.adminAppealsRejectPlaceholder}
                  maxLength={500}
                  rows={3}
                  disabled={!!busyId}
                  style={{ resize: "vertical" }}
                />
              )}
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
