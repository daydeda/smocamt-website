"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarPlus, Clock, UserCheck, XCircle } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { parseRichText } from "@/lib/ui/rich-text";
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

const STATUS_TONE: Record<Proposal["status"], Tone> = { pending: "warning", approved: "success", rejected: "danger", withdrawn: "neutral" };

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB");

export function EventProposalsClient() {
  const { t } = useLanguage();
  const router = useRouter();
  const toast = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<Proposal | null>(null);
  const [reason, setReason] = useState("");

  const STATUS_LABEL: Record<Proposal["status"], string> = {
    pending: t.adminProposalsFilterPending,
    approved: t.adminProposalsFilterApproved,
    rejected: t.adminProposalsFilterRejected,
    withdrawn: t.adminProposalsFilterWithdrawn,
  };

  const FILTER_LABEL: Record<Filter, string> = {
    ...STATUS_LABEL,
    all: t.adminProposalsFilterAll,
  };

  // `showSpinner` is true for an explicit retry; a refresh after a rejection
  // updates the list in place without flashing the loading state.
  const load = useCallback((showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
      setFailed(false);
    }
    fetch("/api/admin/event-proposals")
      .then((r) => {
        if (!r.ok) {
          setFailed(true);
          return null;
        }
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setProposals(d); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred so state updates happen outside the synchronous effect body.
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openRejectModal = (p: Proposal) => {
    setReason("");
    setRejectModal(p);
  };

  const closeRejectModal = () => {
    if (busyId) return;
    setRejectModal(null);
  };

  const confirmReject = async () => {
    if (!rejectModal || busyId) return;
    const id = rejectModal.id;
    const note = reason.trim() || undefined;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/event-proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reviewNote: note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(t.adminOvPropRejectFailed, d?.error || t.adminUiErrorBody);
        return;
      }
      toast.success(t.adminOvPropRejected, rejectModal.title);
      setRejectModal(null);
      load();
    } catch {
      toast.error(t.adminOvPropRejectFailed, t.adminUiErrorBody);
    } finally {
      setBusyId(null);
    }
  };

  const createEventFrom = (p: Proposal) => {
    router.push(`/admin/events?fromProposal=${p.id}`);
  };

  const countFor = (f: Filter) => (f === "all" ? proposals.length : proposals.filter((p) => p.status === f).length);
  const filtered = filter === "all" ? proposals : proposals.filter((p) => p.status === filter);

  return (
    <div className="pb-20">
      <PageHeader title={t.adminProposalsPageTitle} description={t.adminOvPropDesc} />

      {loading ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : failed ? (
        <ErrorState onRetry={() => load(true)} />
      ) : (
        <>
          <Tabs
            idBase="proposals"
            ariaLabel={t.adminProposalsPageTitle}
            value={filter}
            onChange={setFilter}
            tabs={FILTERS.map((f) => ({ id: f, label: FILTER_LABEL[f], count: countFor(f) }))}
          />

          <TabPanel idBase="proposals" id={filter}>
            {filtered.length === 0 ? (
              <EmptyState title={t.adminProposalsReviewEmptyMessage} description={t.adminOvPropEmptyDesc} />
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {filtered.map((p) => {
                  const poster = p.imageUrls?.[0] || p.imageUrl;
                  return (
                    <li key={p.id}>
                      <Panel>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
                            {poster && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={poster} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <h2 style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4, overflowWrap: "anywhere" }}>{p.title}</h2>
                              <p style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "2px 10px", marginTop: 2, flexWrap: "wrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <Building2 size={13} aria-hidden="true" /> {p.club ? p.club.name : fill(t.adminOvPropMajor, { code: p.majorCode ?? "" })}
                                </span>
                                <span>{t.adminProposalsRequestedByLabel} {p.proposer.name}{p.proposer.studentId ? ` (${p.proposer.studentId})` : ""}</span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <Clock size={12} aria-hidden="true" /> {fmtDateTime(p.createdAt)}
                                </span>
                              </p>
                            </div>
                          </div>
                          <div style={{ height: "fit-content" }}>
                            <StatusBadge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</StatusBadge>
                          </div>
                        </div>

                        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)", background: "var(--bg-base)", padding: "10px 12px", borderRadius: 8 }}>
                          <p>{fmtDateTime(p.startTime)} – {fmtDateTime(p.endTime)}</p>
                          {(p.registrationOpenTime || p.registrationCloseTime) && (
                            <p style={{ marginTop: 4 }}>
                              {t.eventRegistrationOpenLabel}: {p.registrationOpenTime ? fmtDateTime(p.registrationOpenTime) : "—"}
                              {" · "}
                              {t.eventRegistrationCloseLabel}: {p.registrationCloseTime ? fmtDateTime(p.registrationCloseTime) : "—"}
                            </p>
                          )}
                          {p.location && <p style={{ marginTop: 4 }}>{p.location}</p>}
                          {p.quota != null && <p style={{ marginTop: 4 }}>{t.thQuota}: {p.quota}</p>}
                          {p.description && (
                            <div style={{ marginTop: 4, overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: parseRichText(p.description) }} />
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                          {p.sessions && p.sessions.length > 1 && (
                            <StatusBadge icon={false}>{fill(t.adminOvPropDays, { n: p.sessions.length })}</StatusBadge>
                          )}
                          {p.walkInsOnly ? (
                            <StatusBadge icon={false}>{t.walkInsOnlyBadge}</StatusBadge>
                          ) : p.walkInsEnabled && (
                            <StatusBadge icon={false}>{t.allowWalkins}{p.quotaWalkIn != null ? ` (${p.quotaWalkIn})` : ""}</StatusBadge>
                          )}
                          {p.firstYearOnly && <StatusBadge icon={false}>{t.firstYearOnly}</StatusBadge>}
                          {(p.targetThai === false || p.targetInternational === false) && (
                            <StatusBadge icon={false}>
                              {[p.targetThai ? t.thaiStudents : null, p.targetInternational ? t.internationalStudents : null].filter(Boolean).join(" + ") || t.targetAudience}
                            </StatusBadge>
                          )}
                          {p.staffUserIds && p.staffUserIds.length > 0 && (
                            <StatusBadge icon={false}>{fill(t.adminOvPropStaff, { n: p.staffUserIds.length })}</StatusBadge>
                          )}
                          {/* Suggested-access ACL — non-binding, staff sets the real
                              allowedRoles/allowedMajors/allowedClubs when creating the
                              event (see the fromProposal prefill in admin/events/page.tsx). */}
                          {p.allowedRoles && p.allowedRoles.length > 0 && (
                            <StatusBadge tone="info" icon={false}>{fill(t.adminOvPropRoles, { list: p.allowedRoles.join(", ") })}</StatusBadge>
                          )}
                          {p.allowedMajors && p.allowedMajors.length > 0 && (
                            <StatusBadge tone="accent" icon={false}>{fill(t.adminOvPropMajors, { list: p.allowedMajors.join(", ") })}</StatusBadge>
                          )}
                          {p.allowedClubs && p.allowedClubs.length > 0 && (
                            <StatusBadge tone="info" icon={false}>{fill(t.adminOvPropClubs, { n: p.allowedClubs.length })}</StatusBadge>
                          )}
                        </div>

                        {p.reviewNote && (
                          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, overflowWrap: "anywhere" }}>{p.reviewNote}</p>
                        )}

                        {p.status !== "pending" && p.reviewer && (
                          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                            <UserCheck size={14} aria-hidden="true" />
                            {t.adminProposalsReviewedByLabel} {p.reviewer.name}
                            {p.reviewedAt && ` · ${fmtDateTime(p.reviewedAt)}`}
                          </p>
                        )}

                        {p.status === "pending" && (
                          <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              onClick={() => openRejectModal(p)}
                              disabled={busyId === p.id}
                              className="btn btn-ghost"
                              style={{ color: "var(--red-600)", gap: 6 }}
                            >
                              <XCircle size={16} aria-hidden="true" /> {t.adminProposalsRejectButton}
                            </button>
                            <button
                              type="button"
                              onClick={() => createEventFrom(p)}
                              disabled={busyId === p.id}
                              className="btn btn-primary"
                              style={{ gap: 6 }}
                            >
                              <CalendarPlus size={16} aria-hidden="true" /> {t.adminProposalsCreateEventButton}
                            </button>
                          </div>
                        )}
                      </Panel>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabPanel>
        </>
      )}

      {rejectModal && (
        <Modal
          open
          onClose={closeRejectModal}
          size="sm"
          dismissible={!busyId}
          title={t.adminProposalsRejectModalTitle}
          description={fill(t.adminOvPropRejectFor, { title: rejectModal.title })}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={closeRejectModal} disabled={!!busyId}>
                {t.adminProposalsCancelButton}
              </button>
              <button type="button" className="btn adm-btn-danger-solid" onClick={confirmReject} disabled={!!busyId}>
                {busyId ? t.saving : t.adminProposalsRejectButton}
              </button>
            </>
          }
        >
          <Field label={t.adminOvNoteLabel} hint={t.adminProposalsRejectModalDescription}>
            {(p) => (
              <textarea
                {...p}
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t.adminProposalsRejectPlaceholder}
                maxLength={1000}
                rows={3}
                disabled={!!busyId}
                style={{ resize: "vertical" }}
              />
            )}
          </Field>
        </Modal>
      )}
    </div>
  );
}
