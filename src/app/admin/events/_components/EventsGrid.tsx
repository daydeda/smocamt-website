"use client";

import { Edit2, Trash2, BellRing, Calendar, MapPin, Clock, Users, Sparkles, BarChart3, Zap, Trophy, ClipboardList, ShieldCheck, AlertTriangle, GraduationCap, Building2 } from "lucide-react";
import { getAllowedEventYears } from "@/lib/access/event-access";
import { formatPendingDetailsDiff, type ParticipantRole, ROLE_LABELS, EMPTY_FORM } from "../_lib/event-model";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";

export function EventsGrid({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditEventDetails, canRepush, handleRepush, repushingId, canViewForms, clubs, deletingId, ensureAssigneeUsersLoaded, filteredEvents, getEventStatus, handleDelete, handleEdit, isAttendanceOnly, lang, loading, openFormBuilder, setEditingId, setFormData, setRegistrationMode, setSessions, setShowForm, setSourceProposalId, t, viewAttendance } = ctx;
  return (
    <>{loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "100px 0", gap: 20 }}>
          <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
          <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>Loading Event Records...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div style={{
          background: "var(--bg-surface)",
          borderRadius: 40,
          padding: 80,
          textAlign: "center",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24
        }}>
          <div style={{ width: 120, height: 120, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <Calendar size={48} />
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 800 }}>{t.noEventsFoundLabel}</h3>
            <p style={{ color: "var(--text-muted)", marginTop: 8 }}>{lang === "th" ? "ลองปรับตัวกรองหรือสร้างกิจกรรมใหม่เพื่อเริ่มต้น" : lang === "cn" ? "尝试调整您的筛选条件或创建一个新活动以开始。" : lang === "mm" ? "စတင်ရန် စစ်ထုတ်မှုများကို ချိန်ညှိပါ သို့မဟုတ် ပွဲအသစ်တစ်ခု ဖန်တီးပါ။" : "Try adjusting your filters or create a new event to get started."}</p>
          </div>
          {!isAttendanceOnly && (
            <button className="btn btn-primary" onClick={() => {
              setEditingId(null); setFormData(EMPTY_FORM); setSourceProposalId(null); setRegistrationMode(null); setSessions([{ title: "", startTime: "", endTime: "", quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null }]); setShowForm(true);
              ensureAssigneeUsersLoaded();
            }}>+ {t.addEventBtn}</button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 32 }}>
          {filteredEvents.map((evt) => {
            const status = getEventStatus(evt);
            const isLive = status === "live";
            const isPast = status === "past";

            return (
              <div key={evt.id} className="event-card-premium" style={{
                background: isPast ? "var(--bg-elevated)" : "var(--bg-surface)",
                borderRadius: 32,
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                position: "relative",
                boxShadow: "0 10px 40px rgb(var(--shadow-rgb) / 0.04)",
                filter: isPast ? "grayscale(0.85)" : "none",
                opacity: isPast ? 0.6 : 1
              }}>
                {/* Card Header (Image/Status) */}
                <div style={{ height: 220, position: "relative", background: "var(--bg-elevated)", padding: 16 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 20, overflow: "hidden", position: "relative" }}>
                    {evt.imageUrl ? (
                      <img src={evt.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, var(--bg-elevated) 0%, var(--border-subtle) 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Calendar size={48} style={{ color: "var(--accent-primary)", opacity: 0.2 }} />
                      </div>
                    )}
                  </div>

                  {/* Top overlays: role/major restriction badges (left) and status
                      badges (right) live in ONE flex row that wraps, so they never
                      overlap on narrow / mobile cards (was: two independent absolute
                      blocks both anchored top:28, which collided when the card shrank). */}
                  <div className="event-card-overlay" style={{ position: "absolute", top: 28, left: 28, right: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    {/* Restriction badges (role + major), stacked */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", minWidth: 0, flexShrink: 1 }}>
                      {evt.allowedRoles && evt.allowedRoles.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgb(var(--indigo-500-rgb) / 0.85)",
                          backdropFilter: "blur(6px)",
                          color: "var(--text-on-color)",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgb(var(--white-rgb) / 0.15)",
                          boxShadow: "0 2px 8px rgb(var(--indigo-500-rgb) / 0.3)",
                          textTransform: "uppercase",
                        }}>
                          <Users size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r.toUpperCase()).join(" • ")}
                          </span>
                        </div>
                      )}
                      {evt.allowedMajors && evt.allowedMajors.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgb(var(--accent-rgb) / 0.85)",
                          backdropFilter: "blur(6px)",
                          color: "var(--text-on-color)",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgb(var(--white-rgb) / 0.15)",
                          boxShadow: "0 2px 8px rgb(var(--accent-rgb) / 0.3)",
                          textTransform: "uppercase",
                        }}>
                          <Users size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.allowedMajors.join(" • ")}
                          </span>
                        </div>
                      )}
                      {evt.allowedClubs && evt.allowedClubs.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgb(var(--violet-500-rgb) / 0.85)",
                          backdropFilter: "blur(6px)",
                          color: "var(--text-on-color)",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgb(var(--white-rgb) / 0.15)",
                          boxShadow: "0 2px 8px rgb(var(--violet-500-rgb) / 0.3)",
                          textTransform: "uppercase",
                        }}>
                          <Building2 size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.allowedClubs!
                              .map((id) => clubs.find((c) => c.id === id)?.name || id)
                              .join(" • ")}
                          </span>
                        </div>
                      )}
                      {getAllowedEventYears(evt).length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgb(var(--emerald-500-rgb) / 0.85)",
                          backdropFilter: "blur(6px)",
                          color: "var(--text-on-color)",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgb(var(--white-rgb) / 0.15)",
                          boxShadow: "0 2px 8px rgb(var(--emerald-500-rgb) / 0.3)",
                          textTransform: "uppercase",
                        }}>
                          <GraduationCap size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {getAllowedEventYears(evt).map((year) => t.studentYearLabel.replace("{year}", String(year))).join(" • ")}
                          </span>
                        </div>
                      )}
                      {/* Managed-by badge — which president manages this event
                          (admin context only; independent of participant access). */}
                      {evt.managedByRoles && evt.managedByRoles.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgb(var(--slate-900-rgb) / 0.78)",
                          backdropFilter: "blur(6px)",
                          color: "var(--text-on-color)",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgb(var(--white-rgb) / 0.15)",
                          boxShadow: "0 2px 8px rgb(var(--shadow-rgb) / 0.3)",
                          textTransform: "uppercase",
                        }}>
                          <ShieldCheck size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.managedByRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r.toUpperCase()).join(" • ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Status badges */}
                    <div className="event-card-status" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0, flexShrink: 1, marginLeft: "auto" }}>
                      {evt.walkInsEnabled && (
                        <div className="badge" style={{ background: "rgb(var(--indigo-500-rgb) / 0.2)", color: "var(--indigo-500)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          <Zap size={12} style={{ marginRight: 4 }} />
                          Walk-in
                        </div>
                      )}
                      {(evt.targetThai !== false && evt.targetInternational !== false) || (evt.targetThai === false && evt.targetInternational === false) ? (
                        <div className="badge" style={{ background: "rgb(var(--emerald-500-rgb) / 0.2)", color: "var(--emerald-500)", border: "1px solid rgb(var(--emerald-500-rgb) / 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          All Students
                        </div>
                      ) : evt.targetThai !== false ? (
                        <div className="badge" style={{ background: "rgb(var(--blue-500-rgb) / 0.2)", color: "var(--blue-500)", border: "1px solid rgb(var(--blue-500-rgb) / 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          Thai Only
                        </div>
                      ) : evt.targetInternational !== false ? (
                        <div className="badge" style={{ background: "rgb(var(--amber-500-rgb) / 0.2)", color: "var(--amber-500)", border: "1px solid rgb(var(--amber-500-rgb) / 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          {"Int'l Only"}
                        </div>
                      ) : null}
                      {/* Discoverability for the staff diff banner (see events.
                          pendingDetailsChanges in schema.ts): the diff itself only
                          renders inside the edit form once opened, so without this
                          badge staff have no way to tell a president edit is
                          waiting for review short of opening every event's editor.
                          Clicking jumps straight into the edit form via handleEdit,
                          which auto-scrolls to formRef where the diff banner lives. */}
            {/* Requires an actual pendingDetailsChanges diff, not just the status
                          flag — a stale/defaulted 'pending' status with no diff (e.g.
                          a pre-existing event backfilled by the details_review_status
                          column's DEFAULT 'pending', see drizzle/0030_backfill_details_review_status.sql)
                          must never show this badge. */}
                      {!isAttendanceOnly && evt.detailsReviewStatus === "pending" && evt.pendingDetailsChanges && (
                        <button
                          type="button"
                          onClick={() => handleEdit(evt)}
                          className="badge animate-pulse-glow"
                          style={{ background: "var(--amber-500)", color: "var(--text-on-color)", border: "none", padding: "6px 12px", cursor: "pointer" }}
                        >
                          <AlertTriangle size={12} style={{ marginRight: 4 }} />
                          {t.eventDetailsPendingStaffLabel || "President edited this event"}
                        </button>
                      )}
                      {isLive && (
                        <div className="badge animate-pulse-glow" style={{ background: "var(--emerald-500)", color: "var(--text-on-color)", border: "none", padding: "6px 12px" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--white)", marginRight: 6 }} />
                          {t.statusLive.toUpperCase()}
                        </div>
                      )}
                      {!isLive && !isPast && (
                        <div className="badge" style={{ background: "var(--accent-primary)", color: "var(--text-on-color)", border: "none", padding: "6px 12px" }}>{t.statusUpcoming.toUpperCase()}</div>
                      )}
                      {isPast && (
                        <div className="badge" style={{ background: "rgb(var(--scrim-rgb) / 0.4)", color: "var(--text-on-color)", border: "none", padding: "6px 12px", backdropFilter: "blur(4px)" }}>{t.statusPast.toUpperCase()}</div>
                      )}
                    </div>
                  </div>

                  {/* Points Badges — house (winner bonus) and, when set, per-attendee individual */}
                  <div style={{ position: "absolute", bottom: 28, left: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {evt.pointsAwarded !== undefined && (
                      <div style={{
                        background: "rgb(var(--scrim-rgb) / 0.7)",
                        backdropFilter: "blur(8px)",
                        color: "var(--text-on-color)",
                        padding: "6px 12px",
                        borderRadius: 14,
                        fontSize: 11,
                        fontWeight: 900,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
                        border: "1px solid rgb(var(--white-rgb) / 0.1)"
                      }} title={t.eventHousePointsHint}>
                        <Trophy size={12} style={{ color: "var(--amber-400)" }} />
                        <span>{evt.pointsAwarded} PTS</span>
                      </div>
                    )}
                    {evt.individualPointsAwarded > 0 && (
                      <div style={{
                        background: "rgb(var(--scrim-rgb) / 0.7)",
                        backdropFilter: "blur(8px)",
                        color: "var(--text-on-color)",
                        padding: "6px 12px",
                        borderRadius: 14,
                        fontSize: 11,
                        fontWeight: 900,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
                        border: "1px solid rgb(var(--white-rgb) / 0.1)"
                      }} title={t.eventIndividualPointsHint}>
                        <Sparkles size={12} style={{ color: "var(--accent-primary)" }} />
                        <span>+{evt.individualPointsAwarded} {t.eventIndividualPointsBadge}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Content */}
                <div style={{ padding: "28px", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.35, overflowWrap: "break-word", wordBreak: "break-word" }}>{evt.title}</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
                        <MapPin size={14} style={{ color: "var(--accent-primary)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.location || "Online / TBD"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                        <Calendar size={14} style={{ color: "var(--accent-primary)" }} />
                        {(() => {
                          const start = new Date(evt.startTime);
                          const end = new Date(evt.endTime);
                          const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                          const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                          
                          const startDateStr = start.toLocaleDateString('en-GB', dateOpts);
                          const endDateStr = end.toLocaleDateString('en-GB', dateOpts);
                          const startTimeStr = start.toLocaleTimeString('en-GB', timeOpts);
                          const endTimeStr = end.toLocaleTimeString('en-GB', timeOpts);

                          if (startDateStr === endDateStr) {
                            return `${startDateStr} ${startTimeStr} - ${endTimeStr}`;
                          } else {
                            return `${startDateStr} ${startTimeStr} - ${endDateStr} ${endTimeStr}`;
                          }
                        })()}
                      </div>
                      {evt.registrationCloseTime && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                          <Clock size={14} style={{ color: "var(--accent-primary)" }} />
                          <span>
                            {t.eventRegistrationCloseLabel}: {(() => {
                              const closeDate = new Date(evt.registrationCloseTime);
                              const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                              const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                              return `${closeDate.toLocaleDateString('en-GB', dateOpts)} ${closeDate.toLocaleTimeString('en-GB', timeOpts)}`;
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card-level diff preview for staff — shows what a president
                      changed (old -> new) right on the card, so staff don't have
                      to open the edit form just to see what's pending. Computed
                      straight from evt (AdminEvent already carries the live
                      values + pendingDetailsChanges), independent of the fuller
                      banner inside the edit form below. */}
                  {!isAttendanceOnly && evt.detailsReviewStatus === "pending" && evt.pendingDetailsChanges && (() => {
                    const diffRows = formatPendingDetailsDiff(evt.pendingDetailsChanges!, evt, t);
                    if (diffRows.length === 0) return null;
                    return (
                      <div style={{
                        display: "flex", flexDirection: "column", gap: 6,
                        background: "rgb(var(--amber-500-rgb) / 0.08)", border: "1px solid rgb(var(--amber-500-rgb) / 0.25)",
                        borderRadius: 14, padding: "12px 14px", marginBottom: 20,
                      }}>
                        {evt.pendingSubmitter && (
                          <p style={{ fontSize: 11, fontWeight: 800, color: "var(--amber-500)", margin: 0 }}>
                            {t.eventDetailsPendingSubmittedByLabel || "Submitted by:"} {evt.pendingSubmitter.name}
                          </p>
                        )}
                        {diffRows.map((row) => (
                          <p key={row.key} style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                            <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong>{" "}
                            {row.oldText} <span style={{ color: "var(--amber-500)", fontWeight: 700 }}>→</span> {row.newText}
                          </p>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Quota Progress */}
                  <div style={{ marginTop: "auto", marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 900, marginBottom: 6 }}>
                      <span style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.thQuota.toUpperCase()}</span>
                      <span style={{ color: "var(--text-primary)" }}>
                        {evt.attendeeCount || 0} / {evt.quota || "∞"}
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 8, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                      <div style={{
                        width: `${evt.quota ? Math.min(100, ((evt.attendeeCount || 0) / evt.quota) * 100) : 0}%`,
                        height: "100%",
                        background: evt.quota && (evt.attendeeCount || 0) >= evt.quota ? "var(--red-house)" : "var(--accent-primary)",
                        borderRadius: 99,
                        transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)"
                      }} />
                    </div>
                    {((evt.quotaThai !== null && evt.quotaThai > 0) || (evt.quotaInternational !== null && evt.quotaInternational > 0) || (evt.quotaWalkIn !== null && evt.quotaWalkIn > 0)) && (
                      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", flexWrap: "wrap" }}>
                        {evt.quotaThai !== null && evt.quotaThai > 0 && (
                          <span>Thai Limit: <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaThai}</strong></span>
                        )}
                        {evt.quotaInternational !== null && evt.quotaInternational > 0 && (
                          <span>{"Int'l Limit:"} <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaInternational}</strong></span>
                        )}
                        {evt.quotaWalkIn !== null && evt.quotaWalkIn > 0 && (
                          <span>Walk-in (extra): <strong style={{ color: "var(--text-secondary)" }}>+{evt.quotaWalkIn}</strong></span>
                        )}
                      </div>
                    )}
                  </div>

                   {/* Actions */}
                   <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
                     <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                       <button
                         className="btn btn-primary"
                         style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                         onClick={() => viewAttendance(evt.id)}
                       >
                         <BarChart3 size={15} /> {lang === "th" ? "การเช็คอิน" : lang === "cn" ? "签到情况" : lang === "mm" ? "ချက်အင်ဝင်ရောက်မှု" : "Attendance"}
                       </button>
                       {canViewForms && (
                       <button
                          className="btn"
                          style={{
                            flex: 1,
                            height: 44,
                            borderRadius: 12,
                            fontSize: 13,
                            background: "linear-gradient(135deg, var(--indigo-500) 0%, var(--indigo-600) 100%)",
                            color: "var(--text-on-color)",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            boxShadow: "0 4px 12px rgb(var(--indigo-600-rgb) / 0.2)",
                            cursor: "pointer"
                          }}
                          onClick={() => openFormBuilder(evt.id, evt.title)}
                        >
                          <ClipboardList size={14} /> {lang === "th" ? "แบบประเมิน" : lang === "cn" ? "评估表单" : lang === "mm" ? "အကဲဖြတ်ပုံစံ" : "Feedback Form"}
                        </button>
                        )}
                     </div>
                     {canRepush && getEventStatus(evt) === "upcoming" && (
                       <button
                         id={`repush-event-${evt.id}-btn`}
                         className="btn btn-ghost"
                         style={{ width: "100%", height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgb(var(--ink-rgb) / 0.03)", fontSize: 13 }}
                         disabled={repushingId === evt.id}
                         onClick={() => handleRepush(evt.id)}
                       >
                         {repushingId === evt.id ? <div className="spinner w-4 h-4 border-2" /> : <BellRing size={13} />} {lang === "th" ? "ส่งแจ้งเตือนอีกครั้ง" : "Re-send push"}
                       </button>
                     )}
                     {(canEditEventDetails || !isAttendanceOnly) && (
                     <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                       {canEditEventDetails && (
                       <button
                         className="btn btn-ghost"
                         style={{ flex: 1, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgb(var(--ink-rgb) / 0.03)", fontSize: 13 }}
                         onClick={() => handleEdit(evt)}
                       >
                         <Edit2 size={13} /> {t.eventEditBtnLabel || "Edit"}
                       </button>
                       )}
                       {!isAttendanceOnly && (
                       <button
                         id={`delete-event-${evt.id}-btn`}
                         className="btn btn-danger"
                         style={{ flex: 1, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13 }}
                         disabled={deletingId === evt.id}
                         onClick={() => handleDelete(evt.id)}
                       >
                         {deletingId === evt.id ? <div className="spinner w-4 h-4 border-2" /> : <Trash2 size={13} />} {t.eventDeleteBtnLabel || "Delete"}
                       </button>
                       )}
                     </div>
                     )}
                   </div>
                </div>
              </div>
            );
          })}
        </div>
      )}</>
  );
}
