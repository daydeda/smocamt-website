"use client";

import { Plus, MapPin, Users, CheckCircle2, X, ExternalLink, ChevronLeft, ChevronRight, AlertCircle, RefreshCw, AlertTriangle } from "lucide-react";
import { parseRichText } from "@/lib/ui/rich-text";
import type { MouseEvent as ReactMouseEvent } from "react";
import { sessionSpansTooLong, splitIntoDailySessions } from "@/lib/events/event-schema";
import { EMPTY_FORM } from "../_lib/event-model";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";
import { PendingPresidentEdit } from "./event-form/PendingPresidentEdit";
import { PointPoolsFields } from "./event-form/PointPoolsFields";
import { WalkInsFields } from "./event-form/WalkInsFields";
import { YearEligibilityField } from "./event-form/YearEligibilityField";
import { CheckInModeField } from "./event-form/CheckInModeField";
import { CheckOutFields } from "./event-form/CheckOutFields";
import { RegistrationModeField } from "./event-form/RegistrationModeField";
import { SessionsEditor } from "./event-form/SessionsEditor";
import { RoleAccessField } from "./event-form/RoleAccessField";
import { MajorAccessField } from "./event-form/MajorAccessField";
import { ClubAccessField } from "./event-form/ClubAccessField";
import { ManagedByField } from "./event-form/ManagedByField";
import { EventStaffField } from "./event-form/EventStaffField";
import { SongsueToggle } from "./event-form/SongsueToggle";

// Preset description colours. Swatches apply on click (no native picker), so
// the same colour can be applied again to another word without the browser
// swallowing the change.
const DESCRIPTION_COLORS = ["#ff6b00", "#e11d48", "#16a34a", "#2563eb", "#7c3aed", "#111827", "#6b7280"];

// Keep the textarea's text selection when a toolbar button is pressed.
const keepSelection = (e: ReactMouseEvent) => e.preventDefault();

export function EventFormPanel({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { addPosters, editingId, error, events, formData, formRef, handleSubmit, injectMarkup, isAttendanceOnly, isPresidentRole, lang, movePoster, posterUploading, registrationMode, removePoster, sessions, set, setEditingId, setFormData, setRegistrationMode, setSessions, setShowForm, setSourceProposalId, showForm, submitting, t, textareaRef } = ctx;
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
          <PendingPresidentEdit ctx={ctx} />

          <form onSubmit={handleSubmit} className="relative">
            <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-10">
              {/* Left Column: Basic Info */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div className="field">
                  <label className="label">{t.eventTitleLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                  <input className="input" required value={formData.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. IT Freshy Night 2026" style={{ fontSize: 16, padding: "16px 20px", borderRadius: 16 }} />
                </div>

                <div className="field">
                  <label className="label">{t.eventShortLinkLabel}</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "var(--text-muted)", fontSize: 14, whiteSpace: "nowrap" }}>/e/</span>
                    <input
                      className="input"
                      value={formData.shortSlug}
                      onChange={(e) => set("shortSlug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      maxLength={40}
                      placeholder="freshy-night-2026"
                    />
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    {t.eventShortLinkHint}
                    {formData.shortSlug && (
                      <> {t.eventShortLinkPreview}: <strong>{`/e/${formData.shortSlug}`}</strong></>
                    )}
                  </p>
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
                <PointPoolsFields ctx={ctx} />

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
                <WalkInsFields ctx={ctx} />

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
                <YearEligibilityField ctx={ctx} />

                {/* Check-in mode: QR/scanner (default) vs self-submitted evidence —
                    see events.checkInMode in schema.ts. Evidence mode is for
                    off-site/self-tracked activities with nowhere to scan a QR
                    (e.g. a multi-day step challenge); each session below then
                    gets its own code word instead of being a scan point. */}
                <CheckInModeField ctx={ctx} />

                {/* Two-step check-in/check-out — only meaningful for QR mode
                    (self-submitted evidence events have no staff-scanned
                    checkout at all). See events.requireCheckOut in schema.ts. */}
                <CheckOutFields ctx={ctx} />

                {/* Registration mode + Sessions / Days editor */}
                <RegistrationModeField ctx={ctx} />

                {/* Sessions / Days — only shown once a registration mode is chosen
                    (multi-day events). A single-day event needs no mode and its
                    lone session mirrors the main start/end above. At least one row
                    is always required. */}
                <SessionsEditor ctx={ctx} />
              </div>

              {/* Right Column: Poster & Description */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Role Access Control — admin/registration/organizer only */}
                <RoleAccessField ctx={ctx} />

                {/* Major Access Control — limits which student majors may join.
                    Combined with the role filter as AND. Empty = all majors.
                    admin/registration/organizer only. */}
                <MajorAccessField ctx={ctx} />

                {/* Club Access Control — limits registration to member(s) of specific
                    club(s) (any club_members role — member or president). Combined
                    with the role/major filters as AND. Empty = no club restriction.
                    admin/registration/organizer only. SEPARATE from "Owning club(s)"
                    below, which controls who MANAGES the event, not who may join. */}
                <ClubAccessField ctx={ctx} />

                {/* Managed By — which president role(s) MANAGE this event (see it in
                    their admin list, view attendance, scan, export). Independent of
                    the role/major access above, which only controls who can JOIN.
                    admin/registration/organizer only — a president must never be
                    able to reassign who manages/owns their own event. */}
                <ManagedByField ctx={ctx} />

                {/* Event Staff — specific PEOPLE (any role, including plain
                    students) assigned to staff THIS event. Separate from
                    Managed By above (which is role-based, president-only):
                    this is a per-person list that exempts their own
                    registration/check-in from the event's quota and no-show
                    strikes (see events.staffUserIds in schema.ts). Staff-only
                    field, like Managed By. */}
                <EventStaffField ctx={ctx} />

                {/* "Also count for Songsue" — staff-only mirror toggle. See
                    events.songsueLinked in schema.ts / src/lib/songsue-sync.ts. */}
                <SongsueToggle ctx={ctx} />

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

              </div>
            </div>
          {/* Description — full width so the editor and the live preview both have
              room to read. Swatches apply straight away (no native picker), so the
              same colour can be applied again to another word. */}
          <div className="field" style={{ marginTop: 32 }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <label className="label" style={{ marginBottom: 0 }}>{t.eventDescriptionLabel}</label>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" title={lang === "th" ? "ตัวหนา" : "Bold"} style={{ padding: "6px 10px", border: "1px solid var(--border-subtle)", borderRadius: 10, fontWeight: 800 }} onMouseDown={keepSelection} onClick={() => injectMarkup("**", "**")}>B</button>
                <button type="button" className="btn btn-ghost btn-sm" title={lang === "th" ? "ลิงก์" : "Link"} style={{ padding: "6px 10px", border: "1px solid var(--border-subtle)", borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 6 }} onMouseDown={keepSelection} onClick={() => injectMarkup("[", "](https://...)")}><ExternalLink size={14} /> {lang === "th" ? "ลิงก์" : "Link"}</button>
                <span aria-hidden style={{ width: 1, height: 22, background: "var(--border-subtle)", margin: "0 4px" }} />
                {DESCRIPTION_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    title={`${lang === "th" ? "สีตัวอักษร" : "Text colour"} ${hex}`}
                    aria-label={`${lang === "th" ? "สีตัวอักษร" : "Text colour"} ${hex}`}
                    onMouseDown={keepSelection}
                    onClick={() => injectMarkup(`{{color:${hex}|`, "}}")}
                    style={{ width: 24, height: 24, borderRadius: 99, background: hex, border: "2px solid var(--bg-surface)", boxShadow: "0 0 0 1px var(--border-medium)", cursor: "pointer", padding: 0 }}
                  />
                ))}
                <label title={lang === "th" ? "เลือกสีเอง" : "Custom colour"} style={{ position: "relative", width: 24, height: 24, borderRadius: 99, background: "conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)", boxShadow: "0 0 0 1px var(--border-medium)", cursor: "pointer", display: "inline-block" }}>
                  <input
                    type="color"
                    defaultValue="#ff6b00"
                    onChange={(e) => {
                      const hex = e.target.value;
                      // Reset to a value no swatch uses, so the next pick (even the same
                      // colour) is a real change and fires onChange again.
                      e.target.value = "#000000";
                      injectMarkup(`{{color:${hex}|`, "}}");
                    }}
                    style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{lang === "th" ? "เขียน" : "Write"}</span>
                <textarea
                  ref={textareaRef}
                  className="input"
                  style={{ flex: 1, minHeight: 320, resize: "vertical", borderRadius: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: 15, lineHeight: 1.7, padding: 18 }}
                  value={formData.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder={lang === "th" ? "อธิบายรายละเอียดเกี่ยวกับกิจกรรม..." : "Tell them about the event..."}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{lang === "th" ? "ตัวอย่างการแสดงผล" : "Live Preview"}</span>
                <div
                  className="custom-scrollbar"
                  style={{ flex: 1, minHeight: 320, maxHeight: 640, overflowY: "auto", overflowWrap: "anywhere", background: "var(--bg-surface)", borderRadius: 16, padding: 22, fontSize: 16, lineHeight: 1.75, color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
                  dangerouslySetInnerHTML={{ __html: parseRichText(formData.description) || `<span style="color: var(--text-muted); font-style: italic;">${lang === "th" ? "ยังไม่มีเนื้อหา..." : "No content yet..."}</span>` }}
                />
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.6 }}>
              <code>**bold**</code> · <code>[text](https://…)</code> · <code>{"{{color:#ff6b00|text}}"}</code> — {lang === "th" ? "เลือกข้อความก่อน แล้วกดปุ่มสีเพื่อใส่สี" : "select text first, then click a colour to apply it"}
            </p>
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
