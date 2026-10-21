"use client";

import { Plus, Edit2, Trash2, Calendar, MapPin, Clock, Users, CheckCircle2, Sparkles, X, ExternalLink, ChevronLeft, ChevronRight, AlertCircle, RefreshCw, Trophy, ShieldCheck, AlertTriangle, GraduationCap, DoorOpen, Building2, QrCode, Check } from "lucide-react";
import { parseRichText } from "@/lib/ui/rich-text";
import { sessionSpansTooLong, splitIntoDailySessions } from "@/lib/events/event-schema";
import { alpha } from "@/lib/ui/color";
import { formatPendingDetailsDiff, ALL_PARTICIPANT_ROLES, type ParticipantRole, ROLE_LABELS, ALL_MAJORS, MAJOR_LABELS, EMPTY_FORM } from "../_lib/event-model";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";

export function EventFormPanel({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { addPosters, addSessionRow, approveEventDetails, assigneeUsers, canEditRestrictedFields, clubs, detailsReviewToggling, discardPendingDetails, editingId, error, events, formData, formRef, handleSubmit, injectMarkup, isAttendanceOnly, isPresidentRole, lang, movePoster, posterUploading, registrationMode, removePoster, removeSessionRow, resyncSongsue, sessions, set, setEditingId, setFormData, setRegistrationMode, setSessions, setShowForm, setSourceProposalId, setStaffAssigneeSearch, showForm, songsueResyncMessage, songsueResyncing, splitSessionRow, staffAssigneeSearch, submitting, t, textareaRef, updateSessionRow } = ctx;
  return (
    <>{showForm && (
        <div
          ref={formRef}
          className="animate-fade-in-up"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-medium)",
            borderRadius: "clamp(20px, 4vw, 32px)",
            padding: "clamp(20px, 5vw, 40px)",
            marginBottom: 48,
            boxShadow: "0 40px 80px rgb(var(--shadow-rgb) / 0.1)",
            position: "relative",
            overflow: "hidden"
          }}
        >
          {/* Form Background Decor */}
          <div style={{ position: "absolute", top: 0, right: 0, width: 300, height: 300, background: "radial-gradient(circle at top right, var(--accent-glow), transparent)", pointerEvents: "none" }} />

          <h2 style={{ fontSize: "clamp(22px, 5vw, 28px)", fontWeight: 900, marginBottom: 32, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 28, background: "var(--accent-primary)", borderRadius: 5 }} />
            {editingId ? t.editEventTitle : t.newEventTitle}
          </h2>

          {/* Always-editable + hold-for-review banner (see events.detailsReviewStatus/
              pendingDetailsChanges in schema.ts): a president is never locked out of
              editing — their edit is just held as a pending diff instead of touching
              the live event, purely informational here. */}
          {isAttendanceOnly && isPresidentRole && editingId && formData.detailsReviewStatus === "pending" &&
            events.find((e) => e.id === editingId)?.pendingDetailsChanges && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              background: "rgb(var(--amber-500-rgb) / 0.08)", border: "1px solid rgb(var(--amber-500-rgb) / 0.25)",
              borderRadius: 16, padding: "16px 20px", marginBottom: 24,
            }}>
              <AlertTriangle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 800, fontSize: 13, color: "var(--amber-500)" }}>
                  {t.eventDetailsPendingBannerTitle || "Pending staff review"}
                </p>
                <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>
                  {t.eventDetailsPendingBannerDesc || "You can keep editing — students still see the previously-approved version until admin/registration staff approve these changes."}
                </p>
              </div>
            </div>
          )}
          {/* Staff view of a PRESIDENT'S pending edit — see
              events.detailsReviewStatus/pendingDetailsChanges in schema.ts. Only
              shown when there is actually something to review: a brand-new event
              (or one staff just created/edited themselves) is auto-marked approved
              at creation (see POST /api/admin/events), and an event nobody but
              staff can ever edit (no club/major president in managedByRoles) can
              never generate a pending edit in the first place. Once shown, it
              disappears the moment staff approves or discards (or the president
              edits again, which just re-shows it with the latest diff). Mirrors
              the same ownerClubIds/ownerMajors-only filter GET /api/admin/reviews
              uses for its queue. The live event is untouched the whole time — see
              PUT /api/admin/events/[id] — so the diff below is computed against
              events.pendingDetailsChanges vs. the current live values, not
              formData (which for staff always shows live values). */}
          {!isAttendanceOnly && editingId && formData.detailsReviewStatus === "pending" &&
            (formData.managedByRoles.includes("club_president") || formData.managedByRoles.includes("major_president")) &&
            events.find((e) => e.id === editingId)?.pendingDetailsChanges && (() => {
            const editingEvent = events.find((e) => e.id === editingId);
            const diffRows = editingEvent?.pendingDetailsChanges
              ? formatPendingDetailsDiff(editingEvent.pendingDetailsChanges, editingEvent, t)
              : [];
            return (
              <div style={{
                display: "flex", flexDirection: "column", gap: 12,
                background: "rgb(var(--amber-500-rgb) / 0.08)", border: "1px solid rgb(var(--amber-500-rgb) / 0.25)",
                borderRadius: 16, padding: "16px 20px", marginBottom: 24,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <AlertTriangle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <p style={{ fontWeight: 800, fontSize: 13, color: "var(--amber-500)" }}>
                        {t.eventDetailsPendingStaffLabel || "President edited this event"}
                      </p>
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>
                        {t.eventDetailsPendingStaffDesc || "The club/major president proposed the changes below. The live event is unaffected until you approve them."}
                      </p>
                      {editingEvent?.pendingSubmitter && (
                        <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
                          {t.eventDetailsPendingSubmittedByLabel || "Submitted by:"} {editingEvent.pendingSubmitter.name}
                          {editingEvent.pendingDetailsSubmittedAt && ` · ${new Date(editingEvent.pendingDetailsSubmittedAt).toLocaleString("en-GB")}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: "transparent", color: "var(--amber-500)", border: "1px solid rgb(var(--amber-500-rgb) / 0.4)",
                      }}
                      disabled={detailsReviewToggling}
                      onClick={discardPendingDetails}
                    >
                      {detailsReviewToggling ? <div className="spinner w-3 h-3 border-2" /> : <X size={14} />}
                      {t.eventDetailsDiscardBtn || "Discard"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: "var(--amber-500)", color: "var(--text-on-color)", border: "none",
                        boxShadow: "0 2px 8px rgb(var(--amber-500-rgb) / 0.35)",
                      }}
                      disabled={detailsReviewToggling}
                      onClick={approveEventDetails}
                    >
                      {detailsReviewToggling ? <div className="spinner w-3 h-3 border-2" /> : <CheckCircle2 size={14} />}
                      {t.eventDetailsApproveBtn || "Approve changes"}
                    </button>
                  </div>
                </div>
                {diffRows.length > 0 && (
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px",
                  }}>
                    {diffRows.map((row) => (
                      <p key={row.key} style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                        <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong>{" "}
                        {row.oldText} <span style={{ color: "var(--amber-500)", fontWeight: 700 }}>→</span> {row.newText}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <form onSubmit={handleSubmit} className="relative">
            <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-10">
              {/* Left Column: Basic Info */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div className="field">
                  <label className="label">{t.eventTitleLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                  <input className="input" required value={formData.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. IT Freshy Night 2026" style={{ fontSize: 16, padding: "16px 20px", borderRadius: 16 }} />
                </div>

                <div className="field">
                  <label className="label">{t.eventLocationLabel}</label>
                  <div style={{ position: "relative" }}>
                    <MapPin size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                    <input className="input" value={formData.location} onChange={(e) => set("location", e.target.value)} placeholder="CAMT Auditorium" style={{ paddingLeft: 44 }} />
                  </div>
                </div>

                {/* Two parallel point pools: house points go to the WINNING house at
                    event-end; individual points go to EACH attendee on every check-in. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventPointsLabel}</label>
                    <div style={{ position: "relative", opacity: canEditRestrictedFields ? 1 : 0.5 }}>
                      <Trophy size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--amber-400)" }} />
                      <input className="input" type="number" min={0} disabled={!canEditRestrictedFields} value={formData.pointsAwarded} onChange={(e) => set("pointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                    <p style={{ fontSize: 11, color: canEditRestrictedFields ? "var(--text-muted)" : "var(--amber-500)", fontWeight: canEditRestrictedFields ? 400 : 700, marginTop: 6 }}>
                      {canEditRestrictedFields ? t.eventHousePointsHint : t.eventStaffOnlyFieldHint}
                    </p>
                  </div>
                  <div className="field">
                    <label className="label">{t.eventIndividualPointsLabel}</label>
                    <div style={{ position: "relative", opacity: canEditRestrictedFields ? 1 : 0.5 }}>
                      <Sparkles size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--accent-primary)" }} />
                      <input className="input" type="number" min={0} disabled={!canEditRestrictedFields} value={formData.individualPointsAwarded} onChange={(e) => set("individualPointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                    <p style={{ fontSize: 11, color: canEditRestrictedFields ? "var(--text-muted)" : "var(--amber-500)", fontWeight: canEditRestrictedFields ? 400 : 700, marginTop: 6 }}>
                      {canEditRestrictedFields ? t.eventIndividualPointsHint : t.eventStaffOnlyFieldHint}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventStartTimeLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                    <input
                      className="input"
                      required
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.startTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newFormData = { ...formData, startTime: val };
                        // Automatically suggest an end time 2 hours later if not set
                        if (val && (!formData.endTime || formData.endTime < val)) {
                          const d = new Date(val);
                          d.setHours(d.getHours() + 2);
                          const offset = d.getTimezoneOffset() * 60000;
                          newFormData.endTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
                        }
                        setFormData(newFormData);
                        // For a single-day event (no mode chosen → Days editor
                        // hidden), keep the sole session row mirrored to the main
                        // start/end so the time still reaches the session on save.
                        if (registrationMode === null && sessions.length === 1) {
                          setSessions([{ ...sessions[0], startTime: val, endTime: newFormData.endTime }]);
                        }
                      }}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t.eventEndTimeLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                    <input
                      className="input"
                      required
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.endTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        set("endTime", val);
                        if (registrationMode === null && sessions.length === 1) {
                          setSessions([{ ...sessions[0], endTime: val }]);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* No mode chosen yet → this range IS the sole session (mirrored
                    above). Warn here since the Days editor that would normally
                    catch this is hidden in that state. */}
                {registrationMode === null && sessionSpansTooLong(formData.startTime, formData.endTime) && (
                  <div style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    background: "color-mix(in srgb, var(--amber-500) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--amber-500) 40%, transparent)",
                    borderRadius: 12, padding: "10px 14px",
                  }}>
                    <AlertCircle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                        {t.multiDaySessionWarning}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const split = splitIntoDailySessions(formData.startTime, formData.endTime);
                          if (split.length > 1) {
                            setRegistrationMode("once");
                            setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null })));
                          }
                        }}
                        className="btn btn-ghost"
                        style={{ alignSelf: "flex-start", fontSize: 12, padding: "6px 12px", borderRadius: 10 }}
                      >
                        {t.splitIntoDays}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventRegistrationOpenLabel}</label>
                    <input
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.registrationOpenTime}
                      onChange={(e) => set("registrationOpenTime", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t.eventRegistrationCloseLabel}</label>
                    <input
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.registrationCloseTime}
                      onChange={(e) => set("registrationCloseTime", e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventQuotaLabel}</label>
                    <div style={{ position: "relative" }}>
                      <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input className="input" type="number" min={1} value={formData.quota || ""} onChange={(e) => set("quota", e.target.value ? Number(e.target.value) : 0)} placeholder={t.unlimitedIfZero} style={{ paddingLeft: 44 }} />
                    </div>
                  </div>

                  <div className="field" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div
                      onClick={() => {
                        // Locked on while Walk-ins Only is set — that mode implies
                        // walkInsEnabled, so it can't be turned off independently.
                        if (formData.walkInsOnly) return;
                        const nextVal = !formData.walkInsEnabled;
                        setFormData({
                          ...formData,
                          walkInsEnabled: nextVal,
                          ...(!nextVal && { quotaWalkIn: null })
                        });
                        // Walk-ins off → clear any per-day walk-in quotas too, so
                        // re-enabling later starts clean (the per-day fields are hidden).
                        if (!nextVal) {
                          setSessions((prev) => prev.map((s) => ({ ...s, quotaWalkIn: null })));
                        }
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: formData.walkInsOnly ? "not-allowed" : "pointer",
                        opacity: formData.walkInsOnly ? 0.6 : 1,
                        border: formData.walkInsEnabled ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.walkInsEnabled ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.walkInsEnabled ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.walkInsEnabled && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.walkInsEnabled ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.allowWalkins}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Walk-ins Only — no pre-registration accepted at all (see
                    api/events/[id]/register). Implies Allow Walk-ins. */}
                <div className="field" style={{ marginTop: 20 }}>
                  <div
                    onClick={() => {
                      const nextVal = !formData.walkInsOnly;
                      setFormData({
                        ...formData,
                        walkInsOnly: nextVal,
                        ...(nextVal && { walkInsEnabled: true }),
                      });
                    }}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.walkInsOnly ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, flexShrink: 0, borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.walkInsOnly ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.walkInsOnly ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s"
                    }}>
                      {formData.walkInsOnly && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <DoorOpen size={18} style={{ flexShrink: 0, color: formData.walkInsOnly ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.walkInsOnly ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.walkInsOnlyToggleLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {t.walkInsOnlyToggleHint}
                      </span>
                    </div>
                  </div>
                </div>

                {formData.walkInsEnabled && !formData.walkInsOnly && (
                  <div className="field" style={{ marginTop: 20 }}>
                    <label className="label">{t.walkInQuota}</label>
                    <div style={{ position: "relative" }}>
                      <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input 
                        className="input" 
                        type="number" 
                        min={1} 
                        value={formData.quotaWalkIn || ""} 
                        onChange={(e) => set("quotaWalkIn", e.target.value ? Number(e.target.value) : null)} 
                        placeholder={t.unlimitedIfEmpty}
                        style={{ paddingLeft: 44 }}
                      />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                      {t.walkInQuotaHint}
                    </p>
                  </div>
                )}

                <div className="field" style={{ marginTop: 20 }}>
                  <label className="label">{t.targetAudience}</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div
                      onClick={() => {
                        const nextVal = !formData.targetThai;
                        setFormData({
                          ...formData,
                          targetThai: nextVal,
                          ...(!nextVal && { quotaThai: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.targetThai ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.targetThai ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.targetThai ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.targetThai && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.targetThai ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.thaiStudents}
                      </span>
                    </div>

                    <div
                      onClick={() => {
                        const nextVal = !formData.targetInternational;
                        setFormData({
                          ...formData,
                          targetInternational: nextVal,
                          ...(!nextVal && { quotaInternational: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.targetInternational ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.targetInternational ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.targetInternational ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.targetInternational && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.targetInternational ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.internationalStudents}
                      </span>
                    </div>
                  </div>

                  {/* Cohort Quota Limits */}
                  {(formData.targetThai || formData.targetInternational) && (
                    <div className="grid gap-5 mt-5" style={{ 
                      gridTemplateColumns: formData.targetThai && formData.targetInternational ? "repeat(auto-fit, minmax(200px, 1fr))" : "1fr"
                    }}>
                      {formData.targetThai && (
                        <div className="field">
                          <label className="label">{t.thaiStudentQuota}</label>
                          <div style={{ position: "relative" }}>
                            <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                            <input 
                              className="input" 
                              type="number" 
                              min={1} 
                              value={formData.quotaThai || ""} 
                              onChange={(e) => set("quotaThai", e.target.value ? Number(e.target.value) : null)} 
                              placeholder={t.unlimitedIfEmpty} 
                              style={{ paddingLeft: 44 }} 
                            />
                          </div>
                        </div>
                      )}

                      {formData.targetInternational && (
                        <div className="field">
                          <label className="label">{t.intlStudentQuota}</label>
                          <div style={{ position: "relative" }}>
                            <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                            <input 
                              className="input" 
                              type="number" 
                              min={1} 
                              value={formData.quotaInternational || ""} 
                              onChange={(e) => set("quotaInternational", e.target.value ? Number(e.target.value) : null)} 
                              placeholder={t.unlimitedIfEmpty} 
                              style={{ paddingLeft: 44 }} 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quota Conflicts Warning */}
                  {(() => {
                    const warnings: string[] = [];
                    const globalLimit = Number(formData.quota) || 0;
                    const thaiLimit = formData.targetThai ? (Number(formData.quotaThai) || 0) : 0;
                    const intlLimit = formData.targetInternational ? (Number(formData.quotaInternational) || 0) : 0;

                    if (globalLimit > 0) {
                      if (formData.targetThai && thaiLimit > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `โควตาสำหรับนักศึกษาไทย (${thaiLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
                            : `Thai student limit (${thaiLimit}) exceeds the overall Participant Quota (${globalLimit}).`
                        );
                      }
                      if (formData.targetInternational && intlLimit > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `โควตาสำหรับนักศึกษาต่างชาติ (${intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
                            : `International student limit (${intlLimit}) exceeds the overall Participant Quota (${globalLimit}).`
                        );
                      }
                      if (formData.targetThai && formData.targetInternational && thaiLimit > 0 && intlLimit > 0 && (thaiLimit + intlLimit) > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `ผลรวมโควตาของนักศึกษาไทยและต่างชาติ (${thaiLimit + intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit}) ทั้งนี้ ระบบจะปิดรับการลงทะเบียนเมื่อผู้สมัครเต็มตามจำนวนโควตาทั้งหมด (${globalLimit} คน)`
                            : `The sum of Thai and International student limits (${thaiLimit + intlLimit}) exceeds the overall Participant Quota (${globalLimit}). The event will stop accepting registrations once the overall limit of ${globalLimit} is reached.`
                        );
                      }
                    }
                    if (warnings.length === 0) return null;

                    return (
                      <div style={{
                        marginTop: 20,
                        padding: "16px 20px",
                        background: "rgb(var(--amber-500-rgb) / 0.1)",
                        border: "1px solid rgb(var(--amber-500-rgb) / 0.2)",
                        borderRadius: 16,
                        color: "var(--amber-500)",
                        fontSize: 13,
                        fontWeight: 600,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        boxShadow: "0 4px 12px rgb(var(--amber-500-rgb) / 0.05)"
                      }}>
                        {warnings.map((w, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--amber-500)" }} />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Student year eligibility: matching any checked year is sufficient. */}
                <fieldset className="field" style={{ marginTop: 20, padding: 0, border: 0 }}>
                  <legend className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <GraduationCap size={18} style={{ color: "var(--accent-primary)" }} />
                    {t.allowedStudentYears}
                  </legend>
                  <p id="allowed-years-hint" style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4, margin: "4px 0 12px" }}>
                    {t.allowedStudentYearsHint}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {[1, 2, 3, 4].map((year) => {
                      const selected = formData.allowedYears.includes(year);
                      return (
                        <label key={year} style={{
                          minHeight: 48, background: "var(--bg-elevated)", borderRadius: 16,
                          display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                          cursor: "pointer", border: `1px solid ${selected ? "var(--accent-primary)" : "transparent"}`,
                          color: selected ? "var(--text-primary)" : "var(--text-secondary)", fontSize: 14, fontWeight: 700,
                        }}>
                          <input
                            type="checkbox"
                            checked={selected}
                            aria-describedby="allowed-years-hint"
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setFormData((prev) => ({
                                ...prev,
                                allowedYears: checked
                                  ? [...prev.allowedYears, year].sort((a, b) => a - b)
                                  : prev.allowedYears.filter((value) => value !== year),
                              }));
                            }}
                            style={{ width: 20, height: 20, flexShrink: 0, accentColor: "var(--accent-primary)" }}
                          />
                          {t.studentYearLabel.replace("{year}", String(year))}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Check-in mode: QR/scanner (default) vs self-submitted evidence —
                    see events.checkInMode in schema.ts. Evidence mode is for
                    off-site/self-tracked activities with nowhere to scan a QR
                    (e.g. a multi-day step challenge); each session below then
                    gets its own code word instead of being a scan point. */}
                <div className="field" style={{ marginTop: 4 }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <QrCode size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "วิธีเช็คอิน" : lang === "cn" ? "签到方式" : lang === "mm" ? "checkin နည်းလမ်း" : "Check-in method"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
                    {lang === "th"
                      ? "เลือก \"หลักฐานด้วยตนเอง\" สำหรับกิจกรรมที่ไม่มีจุดสแกน QR (เช่น ภารกิจนับก้าวหลายวัน) — ผู้เข้าร่วมจะส่งรูปหลักฐาน + รหัสประจำวันแทนการสแกน"
                      : lang === "cn" ? "对于没有二维码扫描点的活动（如多日步数挑战），选择\"自行提交证据\"——参与者将上传证据照片和当日代码词，而不是被扫码签到。"
                      : lang === "mm" ? "QR scan point မရှိသော activity (ဥပမာ - ရက်များစွာကြာ လမ်းလျှောက်စိန်ခေါ်မှု) အတွက် \"မိမိကိုယ်တိုင် သက်သေတင်ခြင်း\" ကို ရွေးပါ — scan မလုပ်ဘဲ ဓာတ်ပုံနှင့် နေ့စဉ်ကုဒ်ကို တင်သွင်းမည်။"
                      : "Pick \"Self-submitted evidence\" for activities with nowhere to scan a QR (e.g. a multi-day step challenge) — participants upload a proof photo + that day's code word instead of being scanned."}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {([
                      {
                        value: "qr" as const,
                        label: lang === "th" ? "สแกน QR / เจ้าหน้าที่เช็คอิน" : lang === "cn" ? "扫码 / 工作人员签到" : lang === "mm" ? "QR scan / ဝန်ထမ်း checkin" : "QR / staff scanner",
                        desc: lang === "th" ? "วิธีเดิม — เช็คอินด้วยการสแกนหรือเจ้าหน้าที่กดยืนยัน" : lang === "cn" ? "默认方式——通过扫码或工作人员确认签到" : lang === "mm" ? "မူလနည်းလမ်း — scan (သို့) ဝန်ထမ်းအတည်ပြုချက်ဖြင့် checkin" : "The existing flow — scanned or manually confirmed by staff.",
                      },
                      {
                        value: "evidence" as const,
                        label: lang === "th" ? "หลักฐานด้วยตนเอง (ไม่ต้องสแกน)" : lang === "cn" ? "自行提交证据（无需扫码）" : lang === "mm" ? "မိမိကိုယ်တိုင် သက်သေတင်ခြင်း (scan မလို)" : "Self-submitted evidence (no scan)",
                        desc: lang === "th" ? "ผู้เข้าร่วมส่งรูป + รหัสประจำวันด้วยตนเองในแดชบอร์ด" : lang === "cn" ? "参与者在仪表盘中自行上传照片和当日代码词" : lang === "mm" ? "dashboard တွင် ဓာတ်ပုံ + နေ့စဉ်ကုဒ်ကို မိမိကိုယ်တိုင် တင်သွင်းမည်" : "Participants submit a photo + code word themselves from the dashboard.",
                      },
                    ]).map((opt) => {
                      const active = formData.checkInMode === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => set("checkInMode", opt.value)}
                          style={{
                            minHeight: 48,
                            background: "var(--bg-elevated)",
                            borderRadius: 16,
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 16px",
                            cursor: "pointer",
                            border: active ? "1px solid var(--accent-primary)" : "1px solid transparent",
                            transition: "all 0.2s",
                          }}
                        >
                          <div style={{
                            width: 22, height: 22, flexShrink: 0, marginTop: 1, borderRadius: "50%",
                            border: active ? "2px solid var(--accent-primary)" : "2px solid var(--border-medium)",
                            display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s",
                          }}>
                            {active && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)" }} />}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.35 }}>
                              {opt.label}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.4 }}>
                              {opt.desc}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Two-step check-in/check-out — only meaningful for QR mode
                    (self-submitted evidence events have no staff-scanned
                    checkout at all). See events.requireCheckOut in schema.ts. */}
                {formData.checkInMode === "qr" && (
                  <div className="field" style={{ marginTop: 4 }}>
                    <label
                      className="label"
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    >
                      <span
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          flexShrink: 0,
                          borderRadius: 5,
                          border: `2px solid ${formData.requireCheckOut ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                          background: formData.requireCheckOut ? "var(--accent-primary)" : "var(--bg-surface)",
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        {/* Real checkbox stays for a11y/form semantics but is visually invisible;
                            the styled <span> above renders the custom look. Nesting it inside the
                            <label> (no separate onClick handler) is what makes the whole row
                            clickable via native label-forwarding, not just the tiny box itself. */}
                        <input
                          type="checkbox"
                          checked={formData.requireCheckOut}
                          onChange={(e) => set("requireCheckOut", e.target.checked)}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
                        />
                        {formData.requireCheckOut && <Check size={13} strokeWidth={3} style={{ color: "var(--text-on-color)", pointerEvents: "none" }} />}
                      </span>
                      <ShieldCheck size={16} style={{ color: "var(--accent-primary)" }} />
                      {lang === "th" ? "ต้องเช็คเอาท์ (สแกน 2 ครั้ง: เข้า + ออกพร้อมหลักฐาน)" : lang === "cn" ? "需要签退（两次扫码：签到 + 附证据签退）" : lang === "mm" ? "checkout လိုအပ်သည် (scan ၂ ကြိမ် - ဝင်ရောက်ခြင်း + သက်သေဖြင့် ထွက်ခွာခြင်း)" : "Require check-out (2 scans: arrival + evidence-reviewed departure)"}
                    </label>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.45 }}>
                      {lang === "th"
                        ? "การสแกนครั้งแรกจะบันทึกแค่การมาถึง (ไม่ได้คะแนน) สแกนซ้ำครั้งที่สองจะให้เจ้าหน้าที่แนบรูปหลักฐานก่อนยืนยันเช็คเอาท์ ซึ่งตอนนั้นจึงจะได้คะแนน"
                        : lang === "cn" ? "第一次扫码只记录到场（不给积分）；第二次扫码时工作人员需先附上证据照片才能确认签退，此时才发放积分。"
                        : lang === "mm" ? "ပထမဆုံး scan သည် ရောက်ရှိမှုကိုသာ မှတ်တမ်းတင်မည် (မှတ်မရသေးပါ) — ဒုတိယ scan တွင် ဝန်ထမ်းသည် checkout အတည်ပြုမီ သက်သေပုံကို ပူးတွဲရမည်၊ ထိုအချိန်၌သာ မှတ်များ ရရှိမည်။"
                        : "The first scan only records arrival (no points yet). A second scan of the same student lets staff attach a proof photo before confirming check-out — that's when points are actually awarded."}
                    </p>

                    {/* Sub-option of requireCheckOut above — only meaningful once
                        that's on. Lets staff skip the mandatory proof photo for
                        events where the in-person scan alone is trusted (e.g. a
                        small activity staff are watching directly). See
                        events.checkOutEvidenceRequired in schema.ts. */}
                    {formData.requireCheckOut && (
                      <label
                        className="label"
                        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginTop: 12, marginLeft: 30 }}
                      >
                        <span
                          style={{
                            position: "relative",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 18,
                            height: 18,
                            flexShrink: 0,
                            borderRadius: 4,
                            border: `2px solid ${formData.checkOutEvidenceRequired ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                            background: formData.checkOutEvidenceRequired ? "var(--accent-primary)" : "var(--bg-surface)",
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={formData.checkOutEvidenceRequired}
                            onChange={(e) => set("checkOutEvidenceRequired", e.target.checked)}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
                          />
                          {formData.checkOutEvidenceRequired && <Check size={12} strokeWidth={3} style={{ color: "var(--text-on-color)", pointerEvents: "none" }} />}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                          {lang === "th"
                            ? "ต้องมีรูปหลักฐานตอนเช็คเอาท์"
                            : lang === "cn" ? "签退需要证据照片"
                            : lang === "mm" ? "checkout လုပ်ရန် သက်သေပုံ လိုအပ်သည်"
                            : "Require a proof photo for check-out"}
                        </span>
                      </label>
                    )}
                    {formData.requireCheckOut && !formData.checkOutEvidenceRequired && (
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0 30px", lineHeight: 1.45 }}>
                        {lang === "th"
                          ? "ปิดไว้: เจ้าหน้าที่ยืนยันเช็คเอาท์ด้วยการสแกนซ้ำเท่านั้น โดยไม่ต้องแนบรูป"
                          : lang === "cn" ? "已关闭：工作人员只需再次扫码即可确认签退，无需附照片。"
                          : lang === "mm" ? "ပိတ်ထားသည်: ဝန်ထမ်းသည် scan ပြန်ခြင်းဖြင့်သာ checkout ကို အတည်ပြုနိုင်ပြီး ပုံ ပူးတွဲရန် မလိုအပ်ပါ။"
                          : "Off: staff confirm check-out with just a second scan — no photo needed."}
                      </p>
                    )}
                  </div>
                )}

                {/* Registration mode + Sessions / Days editor */}
                <div className="field" style={{ marginTop: 4 }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Calendar size={16} style={{ color: "var(--accent-primary)" }} />
                    {t.registrationModeLabel}
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: 999,
                      padding: "1px 8px",
                    }}>
                      {t.registrationModeOptional}
                    </span>
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
                    {t.registrationModeHint}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {([
                      // Not flagged "recommended" — it's the only supported mode today
                      // (per_session below is unbuilt), so a "recommended" badge next to
                      // the sole option would misleadingly imply it was chosen among
                      // real alternatives. See registrationModeHint for the full context.
                      { value: "once" as const, label: t.registrationModeOnce, desc: t.registrationModeOnceDesc, recommended: false },
                      // 'per_session' (separate sign-up each day) is intentionally
                      // hidden: the student registration flow has no per-day path yet,
                      // so picking it would create an event where Day-2 pre-registrants
                      // get pushed into the walk-in path. Re-enable once per-session
                      // registration ships. See docs/features/multi-day-checkin-implementation.md §10.
                      // { value: "per_session" as const, label: t.registrationModePerSession, desc: t.registrationModePerSessionDesc, recommended: false },
                    ]).map((opt) => {
                      const active = registrationMode === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => {
                            if (active) {
                              // Click again to un-select — collapse back to a single
                              // session row mirroring the main start/end, matching
                              // the registrationMode === null convention used above.
                              const first = sessions[0];
                              setRegistrationMode(null);
                              setSessions([{ title: first?.title ?? "", startTime: formData.startTime, endTime: formData.endTime, quotaWalkIn: first?.quotaWalkIn ?? null, evidenceNonce: first?.evidenceNonce ?? null, evidencePrompt: first?.evidencePrompt ?? null }]);
                            } else {
                              setRegistrationMode(opt.value);
                              // The sole row still mirrors the main start/end. If that
                              // range itself spans multiple calendar days, split it into
                              // one row per day right away — otherwise "Day 1" would
                              // silently cover the whole multi-day range as one session
                              // (see sessionSpansTooLong).
                              const first = sessions[0];
                              if (first?.startTime && first?.endTime) {
                                const split = splitIntoDailySessions(first.startTime, first.endTime);
                                if (split.length > 1) {
                                  setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: first.quotaWalkIn ?? null, evidenceNonce: first.evidenceNonce ?? null, evidencePrompt: first.evidencePrompt ?? null })));
                                }
                              }
                            }
                          }}
                          style={{
                            minHeight: 48,
                            background: "var(--bg-elevated)",
                            borderRadius: 16,
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 16px",
                            cursor: "pointer",
                            border: active ? "1px solid var(--accent-primary)" : "1px solid transparent",
                            transition: "all 0.2s",
                          }}
                        >
                          <div style={{
                            width: 22,
                            height: 22,
                            flexShrink: 0,
                            marginTop: 1,
                            borderRadius: "50%",
                            border: active ? "2px solid var(--accent-primary)" : "2px solid var(--border-medium)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "all 0.1s",
                          }}>
                            {active && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)" }} />}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.35 }}>
                                {opt.label}
                              </span>
                              {opt.recommended && (
                                <span style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: "var(--accent-primary)",
                                  background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
                                  border: "1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)",
                                  borderRadius: 999,
                                  padding: "1px 8px",
                                  letterSpacing: 0.2,
                                  whiteSpace: "nowrap",
                                }}>
                                  {t.registrationModeRecommended}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.4 }}>
                              {opt.desc}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Sessions / Days — only shown once a registration mode is chosen
                    (multi-day events). A single-day event needs no mode and its
                    lone session mirrors the main start/end above. At least one row
                    is always required. */}
                {registrationMode !== null && (
                <div className="field">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Clock size={16} style={{ color: "var(--accent-primary)" }} />
                    {t.sessionsHeading}
                  </label>
                  <div style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--accent-primary)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    marginBottom: 14,
                  }}>
                    <Calendar size={15} style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                      {registrationMode === "per_session" ? t.sessionsNotePerSession : t.sessionsNoteOnce}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {sessions.map((s, idx) => (
                      <div
                        key={s.id ?? `new-${idx}`}
                        style={{
                          background: "var(--bg-elevated)",
                          borderRadius: 16,
                          padding: 16,
                          border: "1px solid var(--border-subtle, transparent)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            className="input"
                            value={s.title}
                            onChange={(e) => updateSessionRow(idx, { title: e.target.value })}
                            placeholder={`${t.sessionTitleLabel} (${lang === "th" ? "วันที่" : lang === "cn" ? "第" : lang === "mm" ? "နေ့" : "Day"} ${idx + 1})`}
                            style={{ flex: 1, minWidth: 0 }}
                          />
                          <button
                            type="button"
                            onClick={() => removeSessionRow(idx)}
                            disabled={sessions.length <= 1}
                            title={t.removeDay}
                            style={{
                              width: 40,
                              height: 40,
                              flexShrink: 0,
                              borderRadius: 12,
                              border: "1px solid var(--border-medium)",
                              background: "transparent",
                              color: sessions.length <= 1 ? "var(--text-muted)" : "var(--red-500)",
                              cursor: sessions.length <= 1 ? "not-allowed" : "pointer",
                              opacity: sessions.length <= 1 ? 0.4 : 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.eventStartTimeLabel}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              lang="en-GB"
                              value={s.startTime}
                              onChange={(e) => updateSessionRow(idx, { startTime: e.target.value })}
                            />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.eventEndTimeLabel}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              lang="en-GB"
                              value={s.endTime}
                              onChange={(e) => updateSessionRow(idx, { endTime: e.target.value })}
                            />
                          </div>
                        </div>
                        {sessionSpansTooLong(s.startTime, s.endTime) && (
                          <div style={{
                            display: "flex", gap: 10, alignItems: "flex-start",
                            background: "color-mix(in srgb, var(--amber-500) 12%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--amber-500) 40%, transparent)",
                            borderRadius: 12, padding: "10px 14px",
                          }}>
                            <AlertCircle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                                {t.multiDaySessionWarning}
                              </span>
                              <button
                                type="button"
                                onClick={() => splitSessionRow(idx)}
                                className="btn btn-ghost"
                                style={{ alignSelf: "flex-start", fontSize: 12, padding: "6px 12px", borderRadius: 10 }}
                              >
                                {t.splitIntoDays}
                              </button>
                            </div>
                          </div>
                        )}
                        {formData.walkInsEnabled && !formData.walkInsOnly && (
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.sessionWalkInQuota}</label>
                            <div style={{ position: "relative" }}>
                              <Users size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                              <input
                                className="input"
                                type="number"
                                min={1}
                                value={s.quotaWalkIn ?? ""}
                                onChange={(e) => updateSessionRow(idx, { quotaWalkIn: e.target.value ? Number(e.target.value) : null })}
                                placeholder={t.unlimitedIfEmpty}
                                style={{ paddingLeft: 40 }}
                              />
                            </div>
                          </div>
                        )}
                        {formData.checkInMode === "evidence" && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{
                            background: "color-mix(in srgb, var(--accent-primary) 5%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)",
                            borderRadius: 12, padding: 12,
                          }}>
                            <div className="field" style={{ marginBottom: 0 }}>
                              <label className="label" style={{ fontSize: 12 }}>
                                {lang === "th" ? "รหัสประจำวันนี้ *" : lang === "cn" ? "当日代码词 *" : lang === "mm" ? "ယနေ့ ကုဒ် *" : "This day's code word *"}
                              </label>
                              <input
                                className="input"
                                type="text"
                                value={s.evidenceNonce ?? ""}
                                onChange={(e) => updateSessionRow(idx, { evidenceNonce: e.target.value || null })}
                                placeholder={lang === "th" ? "เช่น สบาย (ประกาศวันนี้)" : lang === "cn" ? "例如：sabai（当天公布）" : lang === "mm" ? "ဥပမာ - sabai (ယနေ့ကြေညာ)" : "e.g. sabai — announced that day"}
                              />
                            </div>
                            <div className="field" style={{ marginBottom: 0 }}>
                              <label className="label" style={{ fontSize: 12 }}>
                                {lang === "th" ? "คำแนะนำสำหรับวันนี้ (ไม่บังคับ)" : lang === "cn" ? "当日提示（可选）" : lang === "mm" ? "ယနေ့ညွှန်ကြားချက် (ရွေးချယ်နိုင်)" : "Prompt for this day (optional)"}
                              </label>
                              <input
                                className="input"
                                type="text"
                                value={s.evidencePrompt ?? ""}
                                onChange={(e) => updateSessionRow(idx, { evidencePrompt: e.target.value || null })}
                                placeholder={lang === "th" ? "เช่น แนบภาพหน้าจอ Strava ที่แสดงระยะทางวันนี้" : lang === "cn" ? "例如：附上显示今日里程的 Strava 截图" : lang === "mm" ? "ဥပမာ - ယနေ့အကွာအဝေး ပြသော Strava screenshot ပူးတွဲပါ" : "e.g. Attach today's Strava distance screenshot"}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addSessionRow}
                    className="btn btn-ghost"
                    style={{ marginTop: 12, gap: 8, borderRadius: 14 }}
                  >
                    <Plus size={16} /> {t.addDay}
                  </button>
                </div>
                )}
              </div>

              {/* Right Column: Poster & Description */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Role Access Control — admin/registration/organizer only */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามบทบาท)" : "Role-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกบทบาทที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกบทบาท"
                      : "Select which roles can see & join this event. Leave all unchecked = visible to everyone."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_PARTICIPANT_ROLES.map((role) => {
                      const isSelected = formData.allowedRoles.includes(role);
                      const roleColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
                        student: {
                          bg: isSelected ? "rgb(var(--indigo-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--indigo-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--indigo-500)" : "var(--text-secondary)",
                          badge: "var(--indigo-500)",
                        },
                        staff: {
                          bg: isSelected ? "rgb(var(--teal-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--teal-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--teal-500)" : "var(--text-secondary)",
                          badge: "var(--teal-500)",
                        },
                        smo: {
                          bg: isSelected ? "rgb(var(--violet-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--violet-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--violet-500)" : "var(--text-secondary)",
                          badge: "var(--violet-500)",
                        },
                        anusmo: {
                          bg: isSelected ? "rgb(var(--pink-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--pink-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--pink-500)" : "var(--text-secondary)",
                          badge: "var(--pink-500)",
                        },
                        club_president: {
                          bg: isSelected ? "rgb(var(--amber-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--amber-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--amber-500)" : "var(--text-secondary)",
                          badge: "var(--amber-500)",
                        },
                        major_president: {
                          bg: isSelected ? "rgb(var(--cyan-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--cyan-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--cyan-500)" : "var(--text-secondary)",
                          badge: "var(--cyan-500)",
                        },
                      };
                      const c = roleColors[role];
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.allowedRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, allowedRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? c.badge : "transparent",
                            border: `2px solid ${isSelected ? c.badge : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: c.text }}>
                            {ROLE_LABELS[role as ParticipantRole]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedRoles.length === 0
                        ? "rgb(var(--emerald-500-rgb) / 0.1)"
                        : "rgb(var(--indigo-500-rgb) / 0.1)",
                      color: formData.allowedRoles.length === 0 ? "var(--emerald-500)" : "var(--indigo-500)",
                      border: `1px solid ${formData.allowedRoles.length === 0 ? "rgb(var(--emerald-500-rgb) / 0.2)" : "rgb(var(--indigo-500-rgb) / 0.2)"}`,
                    }}>
                      {formData.allowedRoles.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกบทบาท" : "✓ Open to all roles")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>
                </div>

                {/* Major Access Control — limits which student majors may join.
                    Combined with the role filter as AND. Empty = all majors.
                    admin/registration/organizer only. */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามสาขา)" : "Major-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกสาขาที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกสาขา"
                      : "Select which majors can see & join this event. Leave all unchecked = open to every major."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_MAJORS.map((major) => {
                      const isSelected = formData.allowedMajors.includes(major);
                      return (
                        <div
                          key={major}
                          onClick={() => {
                            const current = formData.allowedMajors;
                            const next = current.includes(major)
                              ? current.filter((m) => m !== major)
                              : [...current, major];
                            setFormData({ ...formData, allowedMajors: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: isSelected ? "rgb(var(--accent-rgb) / 0.12)" : "var(--bg-elevated)",
                            border: `1px solid ${isSelected ? "rgb(var(--accent-rgb) / 0.5)" : "transparent"}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 80,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? "var(--accent-primary)" : "transparent",
                            border: `2px solid ${isSelected ? "var(--accent-primary)" : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span
                            title={MAJOR_LABELS[major]}
                            style={{ fontSize: 13, fontWeight: 800, color: isSelected ? "var(--accent-primary)" : "var(--text-secondary)" }}
                          >
                            {major}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedMajors.length === 0
                        ? "rgb(var(--emerald-500-rgb) / 0.1)"
                        : "rgb(var(--accent-rgb) / 0.1)",
                      color: formData.allowedMajors.length === 0 ? "var(--emerald-500)" : "var(--accent-primary)",
                      border: `1px solid ${formData.allowedMajors.length === 0 ? "rgb(var(--emerald-500-rgb) / 0.2)" : "rgb(var(--accent-rgb) / 0.2)"}`,
                    }}>
                      {formData.allowedMajors.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกสาขา" : "✓ Open to all majors")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedMajors.join(", ")}`}
                    </div>
                  </div>
                </div>

                {/* Club Access Control — limits registration to member(s) of specific
                    club(s) (any club_members role — member or president). Combined
                    with the role/major filters as AND. Empty = no club restriction.
                    admin/registration/organizer only. SEPARATE from "Owning club(s)"
                    below, which controls who MANAGES the event, not who may join. */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Building2 size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามชมรม)" : "Club-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "จำกัดให้เฉพาะสมาชิกชมรมที่เลือกเท่านั้นที่เห็น/เข้าร่วมกิจกรรมนี้ได้ หากไม่เลือก = ไม่จำกัดตามชมรม"
                      : "Restrict this event to members of the selected club(s) (add members under Admin > Clubs). Leave unchecked = no club restriction."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {clubs.filter((c) => !c.isArchived).length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                      {lang === "th" ? "ยังไม่มีชมรม — สร้างได้ที่ Admin > Clubs" : "No clubs yet — create one under Admin > Clubs."}
                    </p>
                  ) : (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {clubs.filter((c) => !c.isArchived).map((club) => {
                        const isSelected = formData.allowedClubs.includes(club.id);
                        return (
                          <div
                            key={club.id}
                            onClick={() => {
                              const current = formData.allowedClubs;
                              const next = isSelected
                                ? current.filter((id) => id !== club.id)
                                : [...current, club.id];
                              setFormData({ ...formData, allowedClubs: next });
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 16px",
                              borderRadius: 14,
                              background: isSelected ? "rgb(var(--violet-500-rgb) / 0.12)" : "var(--bg-elevated)",
                              border: `1px solid ${isSelected ? "rgb(var(--violet-500-rgb) / 0.5)" : "transparent"}`,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              minWidth: 80,
                            }}
                          >
                            <div style={{
                              width: 20,
                              height: 20,
                              borderRadius: 6,
                              background: isSelected ? "var(--violet-500)" : "transparent",
                              border: `2px solid ${isSelected ? "var(--violet-500)" : "var(--border-medium)"}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              transition: "all 0.15s",
                            }}>
                              {isSelected && <CheckCircle2 size={13} color="white" />}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? "var(--violet-500)" : "var(--text-secondary)" }}>
                              {club.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedClubs.length === 0
                        ? "rgb(var(--emerald-500-rgb) / 0.1)"
                        : "rgb(var(--violet-500-rgb) / 0.1)",
                      color: formData.allowedClubs.length === 0 ? "var(--emerald-500)" : "var(--violet-500)",
                      border: `1px solid ${formData.allowedClubs.length === 0 ? "rgb(var(--emerald-500-rgb) / 0.2)" : "rgb(var(--violet-500-rgb) / 0.2)"}`,
                    }}>
                      {formData.allowedClubs.length === 0
                        ? (lang === "th" ? "✓ ไม่จำกัดตามชมรม" : "✓ No club restriction")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะสมาชิก: " : "Restricted to members of: "}${clubs.filter((c) => formData.allowedClubs.includes(c.id)).map((c) => c.name).join(", ")}`}
                    </div>
                  </div>
                </div>

                {/* Managed By — which president role(s) MANAGE this event (see it in
                    their admin list, view attendance, scan, export). Independent of
                    the role/major access above, which only controls who can JOIN.
                    admin/registration/organizer only — a president must never be
                    able to reassign who manages/owns their own event. */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "ผู้ดูแลกิจกรรม (ประธาน)" : "Managed By (President)"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกประธานที่ดูแลกิจกรรมนี้ (เห็นในรายการ ดูการเช็คอิน สแกน ส่งออก) — ไม่กระทบสิทธิ์การเข้าร่วมของนักศึกษา"
                      : "Choose which president(s) manage this event (view it, see attendance, scan, export). Does NOT affect which students can join."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(["club_president", "major_president"] as const).map((role) => {
                      const isSelected = formData.managedByRoles.includes(role);
                      const accent = role === "club_president" ? "var(--amber-500)" : "var(--cyan-500)";
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.managedByRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, managedByRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: isSelected ? alpha(accent, 0.12) : "var(--bg-elevated)",
                            border: `1px solid ${isSelected ? alpha(accent, 0.5) : "transparent"}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? accent : "transparent",
                            border: `2px solid ${isSelected ? accent : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? accent : "var(--text-secondary)" }}>
                            {ROLE_LABELS[role as ParticipantRole]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.managedByRoles.length === 0
                        ? "rgb(var(--slate-400-rgb) / 0.12)"
                        : "rgb(var(--indigo-500-rgb) / 0.1)",
                      color: formData.managedByRoles.length === 0 ? "var(--text-muted)" : "var(--indigo-500)",
                      border: `1px solid ${formData.managedByRoles.length === 0 ? "var(--border-subtle)" : "rgb(var(--indigo-500-rgb) / 0.2)"}`,
                    }}>
                      {formData.managedByRoles.length === 0
                        ? (lang === "th" ? "จัดการโดยทีมงานเท่านั้น" : "Staff-managed only")
                        : `✓ ${lang === "th" ? "ดูแลโดย: " : "Managed by: "}${formData.managedByRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>

                  {/* Owner club(s)/major(s) — WHICH club_president/major_president may
                      actually manage this event (see EventScopeService). Without an
                      owner assigned here, the event stays hidden from every president
                      even though managedByRoles marks it as president-managed. */}
                  {formData.managedByRoles.includes("club_president") && (
                    <div style={{ marginTop: 14 }}>
                      <label className="label" style={{ fontSize: 12 }}>
                        {lang === "th" ? "ชมรมที่เป็นเจ้าของกิจกรรม" : "Owning club(s)"}
                      </label>
                      {clubs.filter((c) => !c.isArchived).length === 0 ? (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                          {lang === "th" ? "ยังไม่มีชมรม — สร้างได้ที่ Admin > Clubs" : "No clubs yet — create one under Admin > Clubs."}
                        </p>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                          {clubs.filter((c) => !c.isArchived).map((club) => {
                            const isSelected = formData.ownerClubIds.includes(club.id);
                            return (
                              <div
                                key={club.id}
                                onClick={() => {
                                  const current = formData.ownerClubIds;
                                  const next = isSelected
                                    ? current.filter((id) => id !== club.id)
                                    : [...current, club.id];
                                  setFormData({ ...formData, ownerClubIds: next });
                                }}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 10,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  background: isSelected ? "rgb(var(--amber-500-rgb) / 0.15)" : "var(--bg-elevated)",
                                  color: isSelected ? "var(--amber-500)" : "var(--text-secondary)",
                                  border: `1px solid ${isSelected ? "rgb(var(--amber-500-rgb) / 0.4)" : "var(--border-subtle)"}`,
                                }}
                              >
                                {club.name}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {formData.ownerClubIds.length === 0 && (
                        <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginTop: 6 }}>
                          {lang === "th"
                            ? "⚠ ยังไม่ได้กำหนดชมรม — จะไม่แสดงกับประธานชมรมคนใดจนกว่าจะเลือก"
                            : "⚠ No club assigned yet — hidden from every club president until you pick one."}
                        </p>
                      )}
                    </div>
                  )}
                  {formData.managedByRoles.includes("major_president") && (
                    <div style={{ marginTop: 14 }}>
                      <label className="label" style={{ fontSize: 12 }}>
                        {lang === "th" ? "สาขาที่เป็นเจ้าของกิจกรรม" : "Owning major(s)"}
                      </label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                        {ALL_MAJORS.map((major) => {
                          const isSelected = formData.ownerMajors.includes(major);
                          return (
                            <div
                              key={major}
                              onClick={() => {
                                const current = formData.ownerMajors;
                                const next = isSelected
                                  ? current.filter((m) => m !== major)
                                  : [...current, major];
                                setFormData({ ...formData, ownerMajors: next });
                              }}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 10,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                background: isSelected ? "rgb(var(--cyan-500-rgb) / 0.15)" : "var(--bg-elevated)",
                                color: isSelected ? "var(--cyan-500)" : "var(--text-secondary)",
                                border: `1px solid ${isSelected ? "rgb(var(--cyan-500-rgb) / 0.4)" : "var(--border-subtle)"}`,
                              }}
                            >
                              {major}
                            </div>
                          );
                        })}
                      </div>
                      {formData.ownerMajors.length === 0 && (
                        <p style={{ fontSize: 11, color: "var(--cyan-500)", fontWeight: 700, marginTop: 6 }}>
                          {lang === "th"
                            ? "⚠ ยังไม่ได้กำหนดสาขา — จะไม่แสดงกับประธานสาขาคนใดจนกว่าจะเลือก"
                            : "⚠ No major assigned yet — hidden from every major president until you pick one."}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Event Staff — specific PEOPLE (any role, including plain
                    students) assigned to staff THIS event. Separate from
                    Managed By above (which is role-based, president-only):
                    this is a per-person list that exempts their own
                    registration/check-in from the event's quota and no-show
                    strikes (see events.staffUserIds in schema.ts). Staff-only
                    field, like Managed By. */}
                <div className="field" style={{ opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} style={{ color: "var(--indigo-500)" }} />
                    {lang === "th" ? "ทีมงานของกิจกรรมนี้" : "Event Staff"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกคนที่ช่วยดูแลกิจกรรมนี้โดยเฉพาะ (ไม่นับรวมในโควตาผู้เข้าร่วม และไม่ถูกตัดคะแนนขาดงาน)"
                      : "Pick specific people staffing this event. Their registration/check-in won't count against the participant quota and they're exempt from no-show strikes."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {formData.staffUserIds.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      {formData.staffUserIds.map((uid) => {
                        const u = assigneeUsers.find((x) => x.id === uid);
                        return (
                          <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 800, background: "rgb(var(--indigo-500-rgb) / 0.1)", color: "var(--indigo-500)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.25)" }}>
                            {u ? (u.name || u.studentId || uid) : uid}
                            <button type="button" disabled={!canEditRestrictedFields} onClick={() => setFormData({ ...formData, staffUserIds: formData.staffUserIds.filter((x) => x !== uid) })} style={{ background: "none", border: "none", color: "var(--indigo-500)", cursor: "pointer", fontWeight: 900, fontSize: 13, lineHeight: 1 }}>✕</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", height: 42, borderRadius: 12, padding: "0 14px" }}
                    placeholder={lang === "th" ? "ค้นหาด้วยชื่อหรือรหัสนักศึกษา…" : "Search people by name or student ID…"}
                    value={staffAssigneeSearch}
                    onChange={(e) => setStaffAssigneeSearch(e.target.value)}
                    disabled={!canEditRestrictedFields}
                  />
                  {staffAssigneeSearch.trim().length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                      {assigneeUsers
                        .filter((u) => {
                          const q = staffAssigneeSearch.trim().toLowerCase();
                          return (u.name || "").toLowerCase().includes(q) || (u.studentId || "").toLowerCase().includes(q);
                        })
                        .slice(0, 30)
                        .map((u) => {
                          const on = formData.staffUserIds.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              disabled={!canEditRestrictedFields}
                              onClick={() => setFormData({
                                ...formData,
                                staffUserIds: on ? formData.staffUserIds.filter((x) => x !== u.id) : [...formData.staffUserIds, u.id],
                              })}
                              style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgb(var(--indigo-500-rgb) / 0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                            >
                              <span style={{ fontWeight: 700 }}>{u.name || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {u.studentId || u.role}</span></span>
                              <span style={{ fontSize: 12, fontWeight: 900, color: on ? "var(--indigo-500)" : "var(--accent-primary)" }}>{on ? "✓ Added" : "+ Add"}</span>
                            </button>
                          );
                        })}
                      {assigneeUsers.length === 0 && (
                        <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>{lang === "th" ? "กำลังโหลดรายชื่อ…" : "Loading people…"}</p>
                      )}
                    </div>
                  )}
                  {formData.staffUserIds.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 10 }}>
                      {lang === "th" ? "ยังไม่ได้กำหนดทีมงาน" : "No one assigned as staff yet."}
                    </p>
                  )}
                </div>

                {/* "Also count for Songsue" — staff-only mirror toggle. See
                    events.songsueLinked in schema.ts / src/lib/songsue-sync.ts. */}
                <div className="field" style={{ marginTop: 20, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <div
                    onClick={() => set("songsueLinked", !formData.songsueLinked)}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.songsueLinked ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.songsueLinked ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.songsueLinked ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.1s"
                    }}>
                      {formData.songsueLinked && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <ExternalLink size={18} style={{ flexShrink: 0, color: formData.songsueLinked ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.songsueLinked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.songsueLinkedLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {t.songsueLinkedHint}
                      </span>
                    </div>
                  </div>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginTop: 8 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {canEditRestrictedFields && editingId && formData.songsueLinked && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ borderRadius: 12 }}
                        disabled={songsueResyncing}
                        onClick={resyncSongsue}
                      >
                        {songsueResyncing ? t.songsueResyncing : t.songsueResyncButton}
                      </button>
                      {songsueResyncMessage && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{songsueResyncMessage}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="field">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {t.eventPosterLabel}
                    {formData.imageUrls.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-primary)", background: "rgb(var(--accent-rgb) / 0.1)", padding: "2px 8px", borderRadius: 99 }}>
                        {formData.imageUrls.length}
                      </span>
                    )}
                  </label>

                  {/* Poster thumbnails — first one is the cover. Reorder with the
                      arrows; delete with the ×. */}
                  {formData.imageUrls.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12, marginBottom: 12 }}>
                      {formData.imageUrls.map((url, idx) => (
                        <div key={url + idx} style={{
                          position: "relative",
                          aspectRatio: "4/5",
                          borderRadius: 16,
                          overflow: "hidden",
                          background: "var(--black)",
                          border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-medium)"
                        }}>
                          <img src={url} alt={`Poster ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />

                          {idx === 0 && (
                            <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontWeight: 900, color: "var(--text-on-color)", background: "var(--accent-primary)", padding: "3px 7px", borderRadius: 99, letterSpacing: "0.05em", boxShadow: "0 2px 8px rgb(var(--shadow-rgb) / 0.3)" }}>
                              {lang === "th" ? "ปก" : "COVER"}
                            </span>
                          )}

                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => removePoster(idx)}
                            title={lang === "th" ? "ลบ" : "Remove"}
                            style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}
                          >
                            <X size={14} />
                          </button>

                          {/* Reorder */}
                          <div style={{ position: "absolute", bottom: 6, left: 6, right: 6, display: "flex", justifyContent: "space-between", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => movePoster(idx, -1)}
                              disabled={idx === 0}
                              title={lang === "th" ? "ย้ายไปด้านหน้า" : "Move left"}
                              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.35 : 1, backdropFilter: "blur(4px)" }}
                            >
                              <ChevronLeft size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePoster(idx, 1)}
                              disabled={idx === formData.imageUrls.length - 1}
                              title={lang === "th" ? "ย้ายไปด้านหลัง" : "Move right"}
                              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === formData.imageUrls.length - 1 ? "not-allowed" : "pointer", opacity: idx === formData.imageUrls.length - 1 ? 0.35 : 1, backdropFilter: "blur(4px)" }}
                            >
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload dropzone — accepts multiple files at once. */}
                  <div style={{
                    position: "relative",
                    height: formData.imageUrls.length > 0 ? 110 : 180,
                    background: "var(--bg-elevated)",
                    borderRadius: 20,
                    border: "2px dashed var(--border-medium)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    cursor: posterUploading > 0 ? "wait" : "pointer",
                    transition: "all 0.2s"
                  }} onClick={() => { if (posterUploading === 0) document.getElementById("poster-upload")?.click(); }}>
                    {posterUploading > 0 ? (
                      <div style={{ textAlign: "center", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                        <RefreshCw size={24} className="animate-spin" style={{ color: "var(--accent-primary)" }} />
                        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                          {lang === "th" ? `กำลังอัปโหลด ${posterUploading} ไฟล์...` : `Uploading ${posterUploading} image${posterUploading > 1 ? "s" : ""}...`}
                        </p>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", padding: 20 }}>
                        <div style={{ width: formData.imageUrls.length > 0 ? 44 : 64, height: formData.imageUrls.length > 0 ? 44 : 64, borderRadius: "50%", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", color: "var(--text-muted)" }}>
                          <Plus size={formData.imageUrls.length > 0 ? 22 : 28} />
                        </div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
                          {formData.imageUrls.length > 0
                            ? (lang === "th" ? "เพิ่มโปสเตอร์" : "Add more posters")
                            : (lang === "th" ? "อัปโหลดโปสเตอร์ (เลือกได้หลายไฟล์)" : "Upload Posters (select multiple)")}
                        </p>
                        {formData.imageUrls.length === 0 && (
                          <>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>
                              {lang === "th" ? "แนะนำขนาด 1080x1080px (อัตราส่วน 1:1)" : "Recommended: 1080x1080px (1:1 Ratio)"}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              {lang === "th" ? "ขนาดไฟล์สูงสุด 10MB (ระบบจะบีบอัดอัตโนมัติ)" : "Max file size: 10MB (Auto-compressed)"}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    <input
                      type="file"
                      id="poster-upload"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        await addPosters(files);
                        // Allow re-selecting the same file(s) after a removal.
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {formData.imageUrls.length > 1 && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, fontWeight: 600 }}>
                      {lang === "th"
                        ? "นักศึกษาสามารถปัดดูโปสเตอร์ทั้งหมดได้ในหน้าแดชบอร์ด • โปสเตอร์แรกคือภาพปก"
                        : "Students can swipe through all posters on the dashboard • the first poster is the cover."}
                    </p>
                  )}
                </div>

                <div className="field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <label className="label" style={{ marginBottom: 0 }}>{t.eventDescriptionLabel}</label>
                    <div style={{ display: "flex", gap: 4, background: "var(--bg-elevated)", padding: 2, borderRadius: 10 }}>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("**", "**")}><Edit2 size={14} /></button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("[", "](https://...)")}><ExternalLink size={14} /></button>
                      <div style={{ position: "relative" }}>
                        <input type="color" defaultValue="#ff6b00" style={{ opacity: 0, position: "absolute", inset: 0, cursor: "pointer" }} onChange={(e) => injectMarkup(`{{color:${e.target.value}|`, "}}")} />
                        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }}>
                          <span style={{ width: 14, height: 14, borderRadius: 4, background: "linear-gradient(135deg,var(--red-500),var(--indigo-500))", display: "inline-block" }} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-auto md:h-[240px]">
                    <textarea
                      ref={textareaRef}
                      className="input h-[180px] md:h-full"
                      style={{ resize: "none", borderRadius: 16, background: "var(--bg-elevated)", border: "none", fontSize: 14, padding: 16 }}
                      value={formData.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder={lang === "th" ? "อธิบายรายละเอียดเกี่ยวกับกิจกรรม..." : "Tell them about the event..."}
                    />
                    <div
                      className="custom-scrollbar h-[180px] md:h-full"
                      style={{
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        padding: 16,
                        fontSize: 14,
                        lineHeight: 1.6,
                        overflowY: "auto",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-subtle)"
                      }}
                    >
                      <p style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.05em" }}>{lang === "th" ? "ตัวอย่างการแสดงผล" : "Live Preview"}</p>
                      <div dangerouslySetInnerHTML={{ __html: parseRichText(formData.description) || `<span style="color: var(--text-muted); font-style: italic;">${lang === "th" ? "ยังไม่มีเนื้อหา..." : "No content yet..."}</span>` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6" style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {error && <div style={{ color: "var(--red-500)", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><AlertCircle size={16} /> {error}</div>}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 w-full sm:w-auto">
                <button type="button" className="btn btn-ghost btn-lg w-full sm:w-auto" style={{ borderRadius: 16 }} onClick={() => { setShowForm(false); setEditingId(null); setFormData(EMPTY_FORM); setSourceProposalId(null); setRegistrationMode(null); setSessions([]); }}>{t.discardBtn}</button>
                <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto" style={{ borderRadius: 16, minWidth: 200 }} disabled={submitting}>
                  {submitting ? <>{lang === "th" ? "กำลังบันทึก..." : "Saving..."}</> : editingId ? t.updateSystemBtn : t.activateEventBtn}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}</>
  );
}
