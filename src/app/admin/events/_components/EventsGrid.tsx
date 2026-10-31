"use client";

import { AlertTriangle, BarChart3, BellRing, Building2, Calendar, CheckCircle2, ClipboardList, Clock, Edit2, GraduationCap, MapPin, Plus, ShieldCheck, Sparkles, Trash2, Trophy, Users, Zap } from "lucide-react";
import { getAllowedEventYears } from "@/lib/access/event-access";
import { EmptyState, IconButton, LoadingState, StatusBadge } from "@/components/admin/ui";
import { formatPendingDetailsDiff, type ParticipantRole, ROLE_LABELS, EMPTY_FORM } from "../_lib/event-model";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";
import { fmt } from "./fmt";

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" };

function formatRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startDate = start.toLocaleDateString("en-GB", DATE_OPTS);
  const endDate = end.toLocaleDateString("en-GB", DATE_OPTS);
  const startTime = start.toLocaleTimeString("en-GB", TIME_OPTS);
  const endTime = end.toLocaleTimeString("en-GB", TIME_OPTS);
  return startDate === endDate ? `${startDate} ${startTime} - ${endTime}` : `${startDate} ${startTime} - ${endDate} ${endTime}`;
}

const metaRow: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" };

export function EventsGrid({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditEventDetails, canRepush, handleRepush, repushingId, canViewForms, clubs, deletingId, ensureAssigneeUsersLoaded, events, filteredEvents, getEventStatus, handleDelete, handleEdit, isAttendanceOnly, loading, openFormBuilder, setEditingId, setFilterStatus, setFormData, setRegistrationMode, setSearchQuery, setSessions, setShowForm, setSourceProposalId, t, viewAttendance } = ctx;

  const startNewEvent = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setSourceProposalId(null);
    setRegistrationMode(null);
    setSessions([{ title: "", startTime: "", endTime: "", quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null }]);
    setShowForm(true);
    ensureAssigneeUsersLoaded();
  };

  if (loading) return <LoadingState variant="spinner" label={t.adminEvlLoadingEvents} />;

  if (filteredEvents.length === 0) {
    // Two different reasons for "empty": there are no events at all, or the search/filter hides them.
    const noEventsAtAll = !Array.isArray(events) || events.length === 0;
    return noEventsAtAll ? (
      <EmptyState
        icon={<Calendar size={24} />}
        title={t.adminEvlEmptyTitle}
        description={isAttendanceOnly ? t.adminEvlEmptyBodyViewOnly : t.adminEvlEmptyBody}
        action={
          !isAttendanceOnly ? (
            <button type="button" className="btn btn-primary" onClick={startNewEvent}>
              <Plus size={16} aria-hidden="true" />
              {t.addEventBtn}
            </button>
          ) : undefined
        }
      />
    ) : (
      <EmptyState
        icon={<Calendar size={24} />}
        title={t.adminEvlNoMatchTitle}
        description={t.adminEvlNoMatchBody}
        action={
          <button type="button" className="btn btn-ghost" onClick={() => { setSearchQuery(""); setFilterStatus("all"); }}>
            {t.adminEvlClearFilters}
          </button>
        }
      />
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 20 }}>
      {filteredEvents.map((evt) => {
        const status = getEventStatus(evt);
        const isLive = status === "live";
        const isPast = status === "past";
        const years = getAllowedEventYears(evt);
        const hasPendingReview = !isAttendanceOnly && evt.detailsReviewStatus === "pending" && !!evt.pendingDetailsChanges;
        const diffRows = hasPendingReview ? formatPendingDetailsDiff(evt.pendingDetailsChanges!, evt, t) : [];
        const attendees = evt.attendeeCount || 0;
        const quotaFull = !!evt.quota && attendees >= evt.quota;
        const quotaPct = evt.quota ? Math.min(100, (attendees / evt.quota) * 100) : 0;
        const everyone = (evt.targetThai !== false && evt.targetInternational !== false) || (evt.targetThai === false && evt.targetInternational === false);

        return (
          <article
            key={evt.id}
           
            style={{
              background: isPast ? "var(--bg-elevated)" : "var(--bg-surface)",
              borderRadius: 20,
              border: "1px solid var(--border-subtle)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ height: 160, background: "var(--bg-elevated)", padding: 12 }}>
              {evt.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={evt.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 12 }} />
              ) : (
                <div style={{ width: "100%", height: "100%", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--border-subtle)" }}>
                  <Calendar size={40} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                </div>
              )}
            </div>

            <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Title + status: status is colour + icon + text. */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.45, color: "var(--text-primary)", overflowWrap: "anywhere", minWidth: 0 }}>{evt.title}</h2>
                <div style={{ flexShrink: 0 }}>
                  {isLive ? (
                    <StatusBadge tone="success" icon={<span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} />}>{t.statusLive}</StatusBadge>
                  ) : isPast ? (
                    <StatusBadge tone="neutral" icon={<CheckCircle2 size={12} />}>{t.statusPast}</StatusBadge>
                  ) : (
                    <StatusBadge tone="accent" icon={<Calendar size={12} />}>{t.statusUpcoming}</StatusBadge>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={metaRow}>
                  <MapPin size={15} aria-hidden="true" style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 3 }} />
                  <span style={{ overflowWrap: "anywhere" }}>{evt.location || t.adminEvlLocationTbd}</span>
                </div>
                <div style={metaRow}>
                  <Calendar size={15} aria-hidden="true" style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 3 }} />
                  <span>{formatRange(evt.startTime, evt.endTime)}</span>
                </div>
                {evt.registrationCloseTime && (
                  <div style={metaRow}>
                    <Clock size={15} aria-hidden="true" style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 3 }} />
                    <span>
                      {t.eventRegistrationCloseLabel}: {(() => {
                        const closeDate = new Date(evt.registrationCloseTime!);
                        return `${closeDate.toLocaleDateString("en-GB", DATE_OPTS)} ${closeDate.toLocaleTimeString("en-GB", TIME_OPTS)}`;
                      })()}
                    </span>
                  </div>
                )}
              </div>

              {/* Who can join, plus points. Each badge carries an icon and words. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {everyone ? (
                  <StatusBadge tone="neutral" icon={<Users size={12} />}>{t.adminEvlAudAll}</StatusBadge>
                ) : evt.targetThai !== false ? (
                  <StatusBadge tone="info" icon={<Users size={12} />}>{t.adminEvlAudThai}</StatusBadge>
                ) : (
                  <StatusBadge tone="warning" icon={<Users size={12} />}>{t.adminEvlAudIntl}</StatusBadge>
                )}
                {evt.walkInsEnabled && <StatusBadge tone="info" icon={<Zap size={12} />}>{t.adminEvlWalkIn}</StatusBadge>}
                {evt.allowedRoles && evt.allowedRoles.length > 0 && (
                  <StatusBadge tone="info" icon={<Users size={12} />}>
                    {evt.allowedRoles.map((r) => ROLE_LABELS[r as ParticipantRole] || r).join(" • ")}
                  </StatusBadge>
                )}
                {evt.allowedMajors && evt.allowedMajors.length > 0 && (
                  <StatusBadge tone="accent" icon={<GraduationCap size={12} />}>{evt.allowedMajors.join(" • ")}</StatusBadge>
                )}
                {evt.allowedClubs && evt.allowedClubs.length > 0 && (
                  <StatusBadge tone="neutral" icon={<Building2 size={12} />}>
                    {evt.allowedClubs.map((id) => clubs.find((c) => c.id === id)?.name || id).join(" • ")}
                  </StatusBadge>
                )}
                {years.length > 0 && (
                  <StatusBadge tone="success" icon={<GraduationCap size={12} />}>
                    {years.map((year) => t.studentYearLabel.replace("{year}", String(year))).join(" • ")}
                  </StatusBadge>
                )}
                {/* Which president manages this event (admin context only; independent of participant access). */}
                {evt.managedByRoles && evt.managedByRoles.length > 0 && (
                  <StatusBadge tone="neutral" icon={<ShieldCheck size={12} />}>
                    {fmt(t.adminEvlManagedBy, { who: evt.managedByRoles.map((r) => ROLE_LABELS[r as ParticipantRole] || r).join(" • ") })}
                  </StatusBadge>
                )}
                {evt.pointsAwarded !== undefined && (
                  <span title={t.eventHousePointsHint}>
                    <StatusBadge tone="warning" icon={<Trophy size={12} />}>{fmt(t.adminEvlHousePoints, { n: evt.pointsAwarded })}</StatusBadge>
                  </span>
                )}
                {evt.individualPointsAwarded > 0 && (
                  <span title={t.eventIndividualPointsHint}>
                    <StatusBadge tone="accent" icon={<Sparkles size={12} />}>+{evt.individualPointsAwarded} {t.eventIndividualPointsBadge}</StatusBadge>
                  </span>
                )}
              </div>

              {/* A president's edit waits for staff review (events.pendingDetailsChanges). The diff
                  is computed from the event itself, so staff see what changed without opening the editor.
                  Requires an actual diff, not just the status flag (see drizzle/0030 backfill). */}
              {hasPendingReview && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgb(var(--amber-500-rgb) / 0.08)", border: "1px solid rgb(var(--amber-500-rgb) / 0.3)", borderRadius: 14, padding: "12px 14px" }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--amber-700)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={14} aria-hidden="true" />
                    {t.eventDetailsPendingStaffLabel || "President edited this event"}
                  </p>
                  {evt.pendingSubmitter && (
                    <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {t.eventDetailsPendingSubmittedByLabel || "Submitted by:"} {evt.pendingSubmitter.name}
                    </p>
                  )}
                  {diffRows.map((row) => (
                    <p key={row.key} style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong> {row.oldText} <span aria-hidden="true">→</span> {row.newText}
                    </p>
                  ))}
                  <div>
                    <button type="button" className="btn btn-ghost" onClick={() => handleEdit(evt)}>
                      <Edit2 size={14} aria-hidden="true" />
                      {t.eventEditBtnLabel || "Edit"}
                    </button>
                  </div>
                </div>
              )}

              {/* Quota: numbers and the word "Full", not just a red bar. */}
              <div style={{ marginTop: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{t.thQuota}</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {attendees} / {evt.quota || t.adminEvlUnlimited}
                    {quotaFull && <StatusBadge tone="danger">{t.adminEvlQuotaFull}</StatusBadge>}
                  </span>
                </div>
                <div
                  role={evt.quota ? "progressbar" : undefined}
                  aria-valuemin={evt.quota ? 0 : undefined}
                  aria-valuemax={evt.quota ? evt.quota : undefined}
                  aria-valuenow={evt.quota ? attendees : undefined}
                  aria-label={t.thQuota}
                  style={{ width: "100%", height: 8, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden", border: "1px solid var(--border-subtle)" }}
                >
                  <div style={{ width: `${quotaPct}%`, height: "100%", background: quotaFull ? "var(--red-500)" : "var(--accent-primary)", borderRadius: 99 }} />
                </div>
                {((evt.quotaThai !== null && evt.quotaThai > 0) || (evt.quotaInternational !== null && evt.quotaInternational > 0) || (evt.quotaWalkIn !== null && evt.quotaWalkIn > 0)) && (
                  <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                    {evt.quotaThai !== null && evt.quotaThai > 0 && <span>{t.adminEvlThaiLimit}: <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaThai}</strong></span>}
                    {evt.quotaInternational !== null && evt.quotaInternational > 0 && <span>{t.adminEvlIntlLimit}: <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaInternational}</strong></span>}
                    {evt.quotaWalkIn !== null && evt.quotaWalkIn > 0 && <span>{t.adminEvlWalkInExtra}: <strong style={{ color: "var(--text-secondary)" }}>+{evt.quotaWalkIn}</strong></span>}
                  </div>
                )}
              </div>

              {/* Actions: the main ones first, secondary ones below, and Delete alone at the far right. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="btn btn-primary" style={{ flex: 1, minHeight: 44 }} onClick={() => viewAttendance(evt.id)}>
                    <BarChart3 size={16} aria-hidden="true" />
                    {t.adminEvlAttendance}
                  </button>
                  {canViewForms && (
                    <button type="button" className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => openFormBuilder(evt.id, evt.title)}>
                      <ClipboardList size={16} aria-hidden="true" />
                      {t.adminEvlFeedbackForm}
                    </button>
                  )}
                </div>
                {(canEditEventDetails || (canRepush && status === "upcoming") || !isAttendanceOnly) && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {canEditEventDetails && (
                        <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => handleEdit(evt)}>
                          <Edit2 size={15} aria-hidden="true" />
                          {t.eventEditBtnLabel || "Edit"}
                        </button>
                      )}
                      {canRepush && status === "upcoming" && (
                        <button
                          type="button"
                          id={`repush-event-${evt.id}-btn`}
                          className="btn btn-ghost"
                          style={{ minHeight: 44 }}
                          disabled={repushingId === evt.id}
                          onClick={() => handleRepush(evt.id)}
                        >
                          {repushingId === evt.id ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} aria-hidden="true" /> : <BellRing size={15} aria-hidden="true" />}
                          {repushingId === evt.id ? t.adminEvlSendingPush : t.adminEvlResendPush}
                        </button>
                      )}
                    </div>
                    {!isAttendanceOnly && (
                      <IconButton
                        id={`delete-event-${evt.id}-btn`}
                        tone="danger"
                        label={deletingId === evt.id ? t.adminEvlDeleting : fmt(t.adminEvlDeleteEventLabel, { title: evt.title })}
                        icon={deletingId === evt.id ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Trash2 size={18} />}
                        disabled={deletingId === evt.id}
                        onClick={() => handleDelete(evt.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
