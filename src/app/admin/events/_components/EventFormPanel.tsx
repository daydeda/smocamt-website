"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, DoorOpen, Plus, RefreshCw, X } from "lucide-react";
import { Field, IconButton, InlineAlert, Panel, useConfirm } from "@/components/admin/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
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
import { ChoiceFieldset, Disclosure, OptionRow, Stack } from "./event-form/FormControls";

function SubHead({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.5, color: "var(--text-primary)" }}>{children}</h3>;
}

export function EventFormPanel({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { addPosters, editingId, error, events, formData, formRef, handleSubmit, isAttendanceOnly, isPresidentRole, lang, movePoster, posterUploading, registrationMode, removePoster, sessions, set, setEditingId, setFormData, setRegistrationMode, setSessions, setShowForm, setSourceProposalId, showForm, submitting, t } = ctx;
  const confirm = useConfirm();
  const posterInputRef = useRef<HTMLInputElement>(null);
  // null = follow the data (open when something is set); a boolean = the user chose.
  const [multiDayOpen, setMultiDayOpen] = useState<boolean | null>(null);
  const [accessOpen, setAccessOpen] = useState<boolean | null>(null);

  if (!showForm) return null;

  const hasAccessLimits = formData.allowedRoles.length > 0 || formData.allowedMajors.length > 0 || formData.allowedClubs.length > 0;
  const accessSummary = [
    formData.allowedRoles.length === 0 ? t.adminEvfAccessRolesAll : t.adminEvfAccessRolesN.replace("{n}", String(formData.allowedRoles.length)),
    formData.allowedMajors.length === 0 ? t.adminEvfAccessMajorsAll : t.adminEvfAccessMajorsN.replace("{n}", String(formData.allowedMajors.length)),
    formData.allowedClubs.length === 0 ? t.adminEvfAccessClubsNone : t.adminEvfAccessClubsN.replace("{n}", String(formData.allowedClubs.length)),
  ].join(" · ");

  const endBeforeStart = !!formData.startTime && !!formData.endTime && formData.endTime < formData.startTime;
  const regCloseBeforeOpen = !!formData.registrationOpenTime && !!formData.registrationCloseTime && formData.registrationCloseTime < formData.registrationOpenTime;
  const slugTooShort = formData.shortSlug.length > 0 && formData.shortSlug.length < 3;

  // Quota conflicts: advisory only, the server rules are unchanged.
  const quotaWarnings: string[] = [];
  {
    const globalLimit = Number(formData.quota) || 0;
    const thaiLimit = formData.targetThai ? (Number(formData.quotaThai) || 0) : 0;
    const intlLimit = formData.targetInternational ? (Number(formData.quotaInternational) || 0) : 0;
    if (globalLimit > 0) {
      if (formData.targetThai && thaiLimit > globalLimit) {
        quotaWarnings.push(
          lang === "th"
            ? `โควตาสำหรับนักศึกษาไทย (${thaiLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
            : `Thai student limit (${thaiLimit}) exceeds the overall Participant Quota (${globalLimit}).`
        );
      }
      if (formData.targetInternational && intlLimit > globalLimit) {
        quotaWarnings.push(
          lang === "th"
            ? `โควตาสำหรับนักศึกษาต่างชาติ (${intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
            : `International student limit (${intlLimit}) exceeds the overall Participant Quota (${globalLimit}).`
        );
      }
      if (formData.targetThai && formData.targetInternational && thaiLimit > 0 && intlLimit > 0 && (thaiLimit + intlLimit) > globalLimit) {
        quotaWarnings.push(
          lang === "th"
            ? `ผลรวมโควตาของนักศึกษาไทยและต่างชาติ (${thaiLimit + intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit}) ทั้งนี้ ระบบจะปิดรับการลงทะเบียนเมื่อผู้สมัครเต็มตามจำนวนโควตาทั้งหมด (${globalLimit} คน)`
            : `The sum of Thai and International student limits (${thaiLimit + intlLimit}) exceeds the overall Participant Quota (${globalLimit}). The event will stop accepting registrations once the overall limit of ${globalLimit} is reached.`
        );
      }
    }
  }

  const resetAndClose = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setSourceProposalId(null);
    setRegistrationMode(null);
    setSessions([]);
  };

  const onDiscard = async () => {
    const ok = await confirm({
      title: t.adminEvfDiscardTitle,
      message: formData.title.trim()
        ? t.adminEvfDiscardMsgNamed.replace("{title}", formData.title.trim())
        : t.adminEvfDiscardMsg,
      confirmLabel: t.discardBtn,
      cancelLabel: t.adminEvfKeepEditing,
      tone: "danger",
    });
    if (ok) resetAndClose();
  };

  const posterCount = formData.imageUrls.length;

  return (
    <div ref={formRef} className="animate-fade-in-up" style={{ marginBottom: 48 }}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 style={{ fontSize: "clamp(20px, 4vw, 22px)", fontWeight: 800, lineHeight: 1.4, color: "var(--text-primary)" }}>
          {editingId ? t.eventModalTitleEdit : t.eventModalTitleAdd}
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>{t.adminEvfRequiredNote}</p>
      </div>

      {/* Always-editable + hold-for-review banner (see events.detailsReviewStatus/
          pendingDetailsChanges in schema.ts): a president is never locked out of
          editing — their edit is just held as a pending diff instead of touching
          the live event, purely informational here. */}
      {isAttendanceOnly && isPresidentRole && editingId && formData.detailsReviewStatus === "pending" &&
        events.find((e) => e.id === editingId)?.pendingDetailsChanges && (
        <div className="mb-5">
          <InlineAlert tone="warning" title={t.eventDetailsPendingBannerTitle}>
            {t.eventDetailsPendingBannerDesc}
          </InlineAlert>
        </div>
      )}
      {/* Staff view of a PRESIDENT'S pending edit — shown only when there is
          actually something to review (see PendingPresidentEdit). */}
      <div className="mb-5 empty:hidden">
        <PendingPresidentEdit ctx={ctx} />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* ── 1. Basics ─────────────────────────────────────────────── */}
        <Panel title={t.adminEvfSecBasics} description={t.adminEvfSecBasicsDesc}>
          <Stack>
            <Field label={t.eventTitleLabel} required>
              {(p) => (
                <input {...p} className="input" value={formData.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. IT Freshy Night 2026" style={{ fontSize: 16 }} />
              )}
            </Field>

            <Field label={t.eventLocationLabel}>
              {(p) => (
                <input {...p} className="input" value={formData.location} onChange={(e) => set("location", e.target.value)} placeholder="CAMT Auditorium" />
              )}
            </Field>

            <Field
              label={t.eventShortLinkLabel}
              error={slugTooShort ? t.adminEvfSlugTooShort : undefined}
              hint={
                <>
                  {t.eventShortLinkHint}
                  {formData.shortSlug && (
                    <> {t.eventShortLinkPreview}: <strong>{`/e/${formData.shortSlug}`}</strong></>
                  )}
                </>
              }
            >
              {(p) => (
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" style={{ color: "var(--text-muted)", fontSize: 14, whiteSpace: "nowrap" }}>/e/</span>
                  <input
                    {...p}
                    className="input"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={formData.shortSlug}
                    onChange={(e) => set("shortSlug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    maxLength={40}
                    placeholder="freshy-night-2026"
                  />
                </div>
              )}
            </Field>
          </Stack>
        </Panel>

        {/* ── 2. Description and poster ─────────────────────────────── */}
        <Panel title={t.adminEvfSecDetails} description={t.adminEvfSecDetailsDesc}>
          <Stack>
            {/* Description: full width so the editor and the live preview both have
                room to read. See RichTextEditor layout="split". */}
            <div className="field">
              <RichTextEditor
                layout="split"
                lang={lang}
                label={<span className="adm-field-label">{t.eventDescriptionLabel}</span>}
                value={formData.description}
                onChange={(v) => set("description", v)}
                placeholder={lang === "th" ? "อธิบายรายละเอียดเกี่ยวกับกิจกรรม..." : "Tell them about the event..."}
              />
            </div>

            <div className="field">
              <span className="adm-field-label flex items-center gap-2">
                {t.eventPosterLabel}
                {posterCount > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-primary)", background: "rgb(var(--accent-rgb) / 0.1)", padding: "0 8px", borderRadius: 99 }}>
                    {posterCount}
                  </span>
                )}
              </span>

              {/* Poster thumbnails — the first one is the cover. */}
              {posterCount > 0 && (
                <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                  {formData.imageUrls.map((url, idx) => {
                    const scrim = { background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", backdropFilter: "blur(4px)" } as const;
                    return (
                      <li
                        key={url + idx}
                        style={{
                          position: "relative",
                          aspectRatio: "4/5",
                          borderRadius: 16,
                          overflow: "hidden",
                          background: "var(--black)",
                          border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-medium)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={t.adminEvfPosterAlt.replace("{n}", String(idx + 1))} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        {idx === 0 && (
                          <span style={{ position: "absolute", top: 6, left: 6, fontSize: 12, fontWeight: 700, color: "var(--text-on-color)", background: "var(--accent-primary)", padding: "1px 8px", borderRadius: 99 }}>
                            {t.adminEvfPosterCover}
                          </span>
                        )}
                        <div style={{ position: "absolute", top: 4, right: 4 }}>
                          <IconButton size="sm" label={t.adminEvfPosterRemove.replace("{n}", String(idx + 1))} icon={<X size={16} />} onClick={() => removePoster(idx)} style={scrim} />
                        </div>
                        <div style={{ position: "absolute", bottom: 4, left: 4, right: 4, display: "flex", justifyContent: "space-between" }}>
                          <IconButton size="sm" label={t.adminEvfPosterEarlier.replace("{n}", String(idx + 1))} icon={<ChevronLeft size={16} />} onClick={() => movePoster(idx, -1)} disabled={idx === 0} style={scrim} />
                          <IconButton size="sm" label={t.adminEvfPosterLater.replace("{n}", String(idx + 1))} icon={<ChevronRight size={16} />} onClick={() => movePoster(idx, 1)} disabled={idx === posterCount - 1} style={scrim} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Upload — a real button so it works from the keyboard; accepts multiple files. */}
              <button
                type="button"
                onClick={() => posterInputRef.current?.click()}
                disabled={posterUploading > 0}
                className="flex flex-col items-center justify-center gap-1.5 px-4 py-5 text-center"
                style={{
                  minHeight: posterCount > 0 ? 96 : 160,
                  background: "var(--bg-elevated)",
                  borderRadius: 16,
                  border: "2px dashed var(--border-medium)",
                  cursor: posterUploading > 0 ? "wait" : "pointer",
                  color: "var(--text-secondary)",
                }}
              >
                {posterUploading > 0 ? (
                  <>
                    <RefreshCw size={22} className="animate-spin" aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
                    <span role="status" style={{ fontSize: 14, fontWeight: 600 }}>
                      {t.adminEvfUploadingCount.replace("{n}", String(posterUploading))}
                    </span>
                  </>
                ) : (
                  <>
                    <Plus size={posterCount > 0 ? 22 : 28} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {posterCount > 0 ? (lang === "th" ? "เพิ่มโปสเตอร์" : "Add more posters") : (lang === "th" ? "อัปโหลดโปสเตอร์ (เลือกได้หลายไฟล์)" : "Upload Posters (select multiple)")}
                    </span>
                    {posterCount === 0 && (
                      <>
                        <span className="adm-field-hint">{lang === "th" ? "แนะนำขนาด 1080x1080px (อัตราส่วน 1:1)" : "Recommended: 1080x1080px (1:1 Ratio)"}</span>
                        <span className="adm-field-hint">{lang === "th" ? "ขนาดไฟล์สูงสุด 10MB (ระบบจะบีบอัดอัตโนมัติ)" : "Max file size: 10MB (Auto-compressed)"}</span>
                      </>
                    )}
                  </>
                )}
              </button>
              <input
                ref={posterInputRef}
                type="file"
                accept="image/*"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  await addPosters(files);
                  // Allow re-selecting the same file(s) after a removal.
                  e.target.value = "";
                }}
              />
              {posterCount > 1 && <p className="adm-field-hint">{t.adminEvfPosterOrderHint}</p>}
            </div>
          </Stack>
        </Panel>

        {/* ── 3. Schedule ───────────────────────────────────────────── */}
        <Panel title={t.adminEvfSecSchedule} description={t.adminEvfSecScheduleDesc}>
          <Stack>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label={t.eventStartTimeLabel} required hint={t.adminEvfStartHint}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
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
                )}
              </Field>
              <Field label={t.eventEndTimeLabel} required error={endBeforeStart ? t.adminEvfEndBeforeStart : undefined}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
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
                )}
              </Field>
            </div>

            {/* No mode chosen yet → this range IS the sole session (mirrored
                above). Warn here since the Days editor that would normally
                catch this is hidden in that state. */}
            {registrationMode === null && sessionSpansTooLong(formData.startTime, formData.endTime) && (
              <InlineAlert tone="warning">
                <div className="flex flex-col items-start gap-2">
                  <span>{t.multiDaySessionWarning}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const split = splitIntoDailySessions(formData.startTime, formData.endTime);
                      if (split.length > 1) {
                        setRegistrationMode("once");
                        setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null })));
                      }
                    }}
                  >
                    {t.splitIntoDays}
                  </button>
                </div>
              </InlineAlert>
            )}

            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="mb-1 p-0"><SubHead>{t.adminEvfRegWindow}</SubHead></legend>
              <p className="adm-field-hint">{t.adminEvfRegWindowHint}</p>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label={t.eventRegistrationOpenLabel}>
                  {(p) => (
                    <input {...p} className="input" type="datetime-local" lang="en-GB" value={formData.registrationOpenTime} onChange={(e) => set("registrationOpenTime", e.target.value)} />
                  )}
                </Field>
                <Field label={t.eventRegistrationCloseLabel} error={regCloseBeforeOpen ? t.adminEvfRegCloseBeforeOpen : undefined}>
                  {(p) => (
                    <input {...p} className="input" type="datetime-local" lang="en-GB" value={formData.registrationCloseTime} onChange={(e) => set("registrationCloseTime", e.target.value)} />
                  )}
                </Field>
              </div>
            </fieldset>

            {/* Multi-day events are the exception, so they sit behind a disclosure
                (open automatically once a day schedule exists). */}
            <Disclosure
              title={t.adminEvfMultiDayTitle}
              summary={registrationMode === null ? t.adminEvfMultiDayOff : t.adminEvfMultiDayOn.replace("{n}", String(sessions.length))}
              open={multiDayOpen ?? registrationMode !== null}
              onToggle={setMultiDayOpen}
            >
              <RegistrationModeField ctx={ctx} />
              <SessionsEditor ctx={ctx} />
            </Disclosure>
          </Stack>
        </Panel>

        {/* ── 4. Who can join ───────────────────────────────────────── */}
        <Panel title={t.adminEvfSecWho} description={t.adminEvfSecWhoDesc}>
          <Stack>
            <div className="flex flex-col gap-3">
              <SubHead>{t.adminEvfSeats}</SubHead>
              <Field label={t.eventQuotaLabel} hint={t.adminEvfQuotaHint}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={formData.quota || ""}
                    onChange={(e) => set("quota", e.target.value ? Number(e.target.value) : 0)}
                    placeholder={t.unlimitedIfZero}
                  />
                )}
              </Field>

              <OptionRow
                checked={formData.walkInsEnabled}
                // Locked on while Walk-ins Only is set — that mode implies
                // walkInsEnabled, so it can't be turned off independently.
                disabled={formData.walkInsOnly}
                onChange={(nextVal) => {
                  setFormData({
                    ...formData,
                    walkInsEnabled: nextVal,
                    ...(!nextVal && { quotaWalkIn: null }),
                  });
                  // Walk-ins off → clear any per-day walk-in quotas too, so
                  // re-enabling later starts clean (the per-day fields are hidden).
                  if (!nextVal) {
                    setSessions((prev) => prev.map((s) => ({ ...s, quotaWalkIn: null })));
                  }
                }}
                icon={<DoorOpen size={16} />}
                showState
                title={t.allowWalkins}
                hint={formData.walkInsOnly ? t.adminEvfWalkInsLocked : t.adminEvfWalkInsHint}
              />

              {/* Walk-ins Only — no pre-registration accepted at all (see
                  api/events/[id]/register). Implies Allow Walk-ins. */}
              <WalkInsFields ctx={ctx} />

              {formData.walkInsEnabled && !formData.walkInsOnly && (
                <Field label={t.walkInQuota} hint={t.walkInQuotaHint}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={formData.quotaWalkIn || ""}
                      onChange={(e) => set("quotaWalkIn", e.target.value ? Number(e.target.value) : null)}
                      placeholder={t.unlimitedIfEmpty}
                    />
                  )}
                </Field>
              )}
            </div>

            <ChoiceFieldset legend={t.targetAudience} hint={t.adminEvfAudienceHint}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OptionRow
                  checked={formData.targetThai}
                  onChange={(nextVal) => setFormData({ ...formData, targetThai: nextVal, ...(!nextVal && { quotaThai: null }) })}
                  title={t.thaiStudents}
                />
                <OptionRow
                  checked={formData.targetInternational}
                  onChange={(nextVal) => setFormData({ ...formData, targetInternational: nextVal, ...(!nextVal && { quotaInternational: null }) })}
                  title={t.internationalStudents}
                />
              </div>

              {/* Cohort quota limits */}
              {(formData.targetThai || formData.targetInternational) && (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {formData.targetThai && (
                    <Field label={t.thaiStudentQuota} hint={t.unlimitedIfEmpty}>
                      {(p) => (
                        <input {...p} className="input" type="number" inputMode="numeric" min={1} value={formData.quotaThai || ""} onChange={(e) => set("quotaThai", e.target.value ? Number(e.target.value) : null)} />
                      )}
                    </Field>
                  )}
                  {formData.targetInternational && (
                    <Field label={t.intlStudentQuota} hint={t.unlimitedIfEmpty}>
                      {(p) => (
                        <input {...p} className="input" type="number" inputMode="numeric" min={1} value={formData.quotaInternational || ""} onChange={(e) => set("quotaInternational", e.target.value ? Number(e.target.value) : null)} />
                      )}
                    </Field>
                  )}
                </div>
              )}

              {quotaWarnings.length > 0 && (
                <InlineAlert tone="warning" title={t.adminEvfQuotaConflictTitle}>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                    {quotaWarnings.map((w, idx) => <li key={idx}>{w}</li>)}
                  </ul>
                </InlineAlert>
              )}
            </ChoiceFieldset>

            {/* Student year eligibility: matching any checked year is sufficient. */}
            <YearEligibilityField ctx={ctx} />

            {/* Role / major / club limits are the exception and staff-only, so
                they sit behind a disclosure. What is currently set stays visible
                in the summary line, and it opens by itself when a limit exists. */}
            <Disclosure
              title={t.adminEvfAccessTitle}
              summary={accessSummary}
              open={accessOpen ?? hasAccessLimits}
              onToggle={setAccessOpen}
            >
              <RoleAccessField ctx={ctx} />
              <MajorAccessField ctx={ctx} />
              {/* Club access limits who may JOIN; it is separate from "Owning club(s)" below, which controls who MANAGES. */}
              <ClubAccessField ctx={ctx} />
            </Disclosure>
          </Stack>
        </Panel>

        {/* ── 5. Check-in and check-out ─────────────────────────────── */}
        <Panel title={t.adminEvfSecCheckin} description={t.adminEvfSecCheckinDesc}>
          <Stack>
            {/* Check-in mode: QR/scanner (default) vs self-submitted evidence —
                see events.checkInMode in schema.ts. */}
            <CheckInModeField ctx={ctx} />
            {/* Two-step check-in/check-out — only meaningful for QR mode. */}
            <CheckOutFields ctx={ctx} />
          </Stack>
        </Panel>

        {/* ── 6. Points ─────────────────────────────────────────────── */}
        <Panel title={t.adminEvfSecPoints} description={t.adminEvfSecPointsDesc}>
          {/* Two parallel point pools: house points go to the WINNING house at
              event-end; individual points go to EACH attendee on every check-in. */}
          <PointPoolsFields ctx={ctx} />
        </Panel>

        {/* ── 7. Management and staff ───────────────────────────────── */}
        <Panel title={t.adminEvfSecStaff} description={t.adminEvfSecStaffDesc}>
          <Stack>
            {/* Managed By — which president role(s) MANAGE this event. Independent
                of the role/major access above, which only controls who can JOIN. */}
            <ManagedByField ctx={ctx} />
            {/* Event Staff — specific PEOPLE assigned to staff THIS event. */}
            <EventStaffField ctx={ctx} />
            {/* "Also count for Songsue" — staff-only mirror toggle. */}
            <SongsueToggle ctx={ctx} />
          </Stack>
        </Panel>

        {/* A failed save is reported in place, at the end of the form, not
            inside the floating bar. */}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        {/* Only the two actions float, so they stay in reach while scrolling a
            long form. Cancel first, primary last. */}
        <div className="adm-action-bar">
          <div className="adm-action-bar-inner">
            <button type="button" className="btn btn-ghost" disabled={submitting} onClick={onDiscard}>
              {t.discardBtn}
            </button>
            <button type="submit" className="btn btn-primary" style={{ minWidth: 160 }} disabled={submitting} aria-busy={submitting}>
              {submitting && <span className="spinner" aria-hidden="true" style={{ width: 16, height: 16 }} />}
              {submitting ? t.adminEvfSaving : editingId ? t.adminEvfSaveChanges : t.adminEvfCreateEvent}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
