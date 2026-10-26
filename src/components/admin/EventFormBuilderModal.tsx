"use client";

import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, Sparkles, Zap } from "lucide-react";
import { EventFormBuilderModalProps } from "./event-form-builder/form-builder-model";
import { useEventFormBuilder } from "./event-form-builder/useEventFormBuilder";
import { BuilderHeader } from "./event-form-builder/BuilderHeader";
import { FormSelector } from "./event-form-builder/FormSelector";
import { NewFormTypePicker } from "./event-form-builder/NewFormTypePicker";
import { BuilderTabs } from "./event-form-builder/BuilderTabs";
import { ReviewGateBanner } from "./event-form-builder/ReviewGateBanner";
import { RequestChangesModal } from "./event-form-builder/RequestChangesModal";
import { GeneralSettings } from "./event-form-builder/GeneralSettings";
import { ScheduleWindow } from "./event-form-builder/ScheduleWindow";
import { RespondentVisibility } from "./event-form-builder/RespondentVisibility";
import { SFormAssignment } from "./event-form-builder/SFormAssignment";
import { SectionsEditor } from "./event-form-builder/SectionsEditor";
import { BuilderFooter } from "./event-form-builder/BuilderFooter";
import { AutoAwardBanner } from "./event-form-builder/AutoAwardBanner";
import { SubmissionStats } from "./event-form-builder/SubmissionStats";
import { SubmissionsList } from "./event-form-builder/SubmissionsList";
import { ConfirmModal } from "./event-form-builder/ConfirmModal";

export function EventFormBuilderModal({ eventId, eventTitle, onClose, onChanged }: EventFormBuilderModalProps) {
  const ctx = useEventFormBuilder({ eventId, eventTitle, onClose, onChanged });
  const { activeFormId, canManageForms, closeFormBuilder, formBuilderError, formBuilderSuccess, formClosesAt, formIndividualPoints, formIsAwarded, formLoading, formOpensAt, formPoints, formTab, setFormIndividualPoints, setFormPoints, showNewFormPicker, t } = ctx;

  // Portalled to document.body: this panel is mounted from admin/clubs and
  // admin/majors too, nested inside those pages' `.animate-fade-in-up`
  // wrapper. That wrapper is the target of a CSS transform animation, which
  // makes it the containing block for any `position: fixed` descendant —
  // so without a portal this "full-screen" panel was only ever full relative
  // to that wrapper's box, not the actual viewport (visibly not full-page on
  // those two pages, unlike admin/events/page.tsx which mounts this modal as
  // a sibling outside its own animate-fade-in-up div). Mirrors the same fix
  // already used for the nested requestChangesOpen modal below.
  return createPortal(
    <>
        {/* Centered dialog with a dimmed/blurred backdrop — matches the rest of
            the app's modal pattern (see admin/clubs's Members/Create modals)
            instead of a full-screen page-covering panel. The card itself is a
            flex column capped at 90vh and scrolls as one column: only the tab
            bar is pinned (sticky), so the header and form chips scroll away
            and the body gets the full height on small screens. */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(var(--scrim-rgb) / 0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2200,
            padding: "clamp(12px, 4vw, 24px)",
          }}
          onClick={closeFormBuilder}
        >
          <div
            className="animate-fade-in-up custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "100%",
              maxWidth: 900,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: "clamp(20px, 5vw, 32px)",
              overflowY: "auto",
              boxShadow: "0 30px 60px rgb(var(--shadow-rgb) / 0.3)",
              border: "1px solid var(--border-medium)",
            }}
          >

            {/* Modal Header */}
            <BuilderHeader ctx={ctx} />

            {/* KAS Form Selector — chips for each form + Add button */}
            <FormSelector ctx={ctx} />

            {/* New Form Type Picker */}
            <NewFormTypePicker ctx={ctx} />

            {/* Modal Navigation Tabs */}
            <BuilderTabs ctx={ctx} />

            {/* Modal Body — scrolls with the card, under the sticky tabs. */}
            <div>
            {formLoading ? (
              <div style={{ padding: "80px 0", textAlign: "center" }}>
                <div className="spinner w-8 h-8 border-4 border-t-transparent" style={{ margin: "0 auto 16px" }} />
                <p style={{ color: "var(--text-muted)", fontWeight: 700 }}>{t.fbFetchingData || "Fetching evaluation system data..."}</p>
              </div>
            ) : showNewFormPicker && !activeFormId ? (
              <div style={{ padding: "60px 40px", textAlign: "center" }}>
                <ClipboardList size={48} style={{ color: "var(--text-muted)", margin: "0 auto 20px", opacity: 0.3, display: "block" }} />
                <h4 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t.fbSelectFormTypeToStart || "Select a form type above to get started"}</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {t.fbSelectFormTypeDesc || "Each form type (K Pre-Test, K Post-Test, A - Attitude, S - Skill) can only be created once per event."}
                </p>
              </div>
            ) : !activeFormId && !canManageForms ? (
              // Only a genuine "nothing to show" case for view-only viewers (smo)
              // with zero forms. A manager with activeFormId === null is either
              // mid-pick (handled above) or actively drafting a brand-new,
              // not-yet-saved form (see startNewForm) — that must fall through to
              // the editor below, not this placeholder.
              <div style={{ padding: "60px 40px", textAlign: "center" }}>
                <ClipboardList size={48} style={{ color: "var(--text-muted)", margin: "0 auto 20px", opacity: 0.3, display: "block" }} />
                <h4 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t.fbNoFormsYetTitle || "No feedback forms yet"}</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {t.fbNoFormsYetDesc || "This event's organizer hasn't created one yet."}
                </p>
              </div>
            ) : (
              <div style={{ padding: "clamp(16px, 5vw, 40px)" }}>
                {formBuilderSuccess && (
                  <div className="animate-fade-in" style={{
                    background: "rgb(var(--emerald-500-rgb) / 0.08)",
                    border: "1px solid rgb(var(--emerald-500-rgb) / 0.2)",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 28,
                    color: "var(--emerald-500)",
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}>
                    <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> {formBuilderSuccess}
                  </div>
                )}

                {formBuilderError && (
                  <div className="animate-fade-in" style={{
                    background: "rgb(var(--red-500-rgb) / 0.08)",
                    border: "1px solid rgb(var(--red-500-rgb) / 0.2)",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 28,
                    color: "var(--red-500)",
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {formBuilderError}
                  </div>
                )}

                {/* Review gate banner (see forms.reviewStatus in schema.ts) — a
                    president's form is hidden-but-visible ("closed") to
                    participants until staff approves it here; editing an
                    approved form sends it back to pending automatically
                    (server-side, see api/admin/events/[id]/form/route.ts). */}
                <ReviewGateBanner ctx={ctx} />

                {/* Custom "Request Changes" modal — replaces window.prompt.
                    Portaled to document.body: this lives inside the Feedback
                    Form modal's own .animate-fade-in-up scrollable card
                    (line ~4850), which keeps a residual transform after its
                    entrance animation finishes (fill-mode: both) — that makes
                    it the containing block for any position:fixed descendant,
                    so an un-portaled overlay here scrolls WITH that card
                    instead of pinning to the viewport (the exact bug
                    ProposeEventSection.tsx's own modals already hit — see
                    that file's identical comment). Centered + clamp()-padded
                    so it stays usable on mobile (375px) and iPad (768/1024px)
                    widths. */}
                <RequestChangesModal ctx={ctx} />

                {formTab === "edit" && canManageForms ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {/* General Settings — title/description card is full-width with the
                        type badge inline (was a second, much-taller sibling card that
                        left a large dead-space gap under this one). Rewards + status
                        below get their own equal-height row instead. */}
                    <GeneralSettings ctx={ctx} />

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 24 }}>
                      <div className="field" style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)" }}>
                        <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                          <Zap size={14} style={{ color: "var(--accent-primary)" }} /> {t.fbHousePointsReward || "House Points Reward"}
                        </label>
                        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{t.fbWinningHouseGetsPoints || "Winning house gets these points."}</p>
                        <input
                          type="number"
                          className="input"
                          style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", fontWeight: 800 }}
                          value={formPoints}
                          onChange={e => setFormPoints(Math.max(0, parseInt(e.target.value) || 0))}
                        />
                      </div>

                      <div className="field" style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)" }}>
                        <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                          <Sparkles size={14} style={{ color: "var(--accent-primary)" }} /> {t.fbIndividualPointsReward || "Individual Points Reward"}
                        </label>
                        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{t.fbEachSubmitterGetsPoints || "Each student gets these points when they submit."}</p>
                        <input
                          type="number"
                          className="input"
                          style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", fontWeight: 800 }}
                          value={formIndividualPoints}
                          onChange={e => setFormIndividualPoints(Math.max(0, parseInt(e.target.value) || 0))}
                        />
                      </div>

                      {(() => {
                        // Read-only lifecycle status. There is no manual open/close
                        // anymore — the schedule window below drives everything, and
                        // points auto-award once the close time passes.
                        const now = new Date();
                        const opens = formOpensAt ? new Date(formOpensAt) : null;
                        const closes = formClosesAt ? new Date(formClosesAt) : null;
                        let dot = "var(--green-house)";
                        let label = t.fbStatusOpenForEntries || "Open for entries";
                        if (formIsAwarded) {
                          dot = "var(--emerald-500)"; label = t.fbStatusFinalizedAwarded || "Finalized & points awarded";
                        } else if (closes && now > closes) {
                          dot = "var(--text-muted)"; label = t.fbStatusClosedAutoAward || "Closed — points will be awarded automatically";
                        } else if (opens && now < opens) {
                          dot = "var(--indigo-500)"; label = t.fbStatusScheduledNotOpen || "Scheduled — not open yet";
                        }
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 10, height: 10, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)" }}>
                                {t.fbStatusPrefix || "Status:"} {label}
                              </span>
                            </div>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                              {t.fbStatusDesc || "Set the open/close times in the schedule below. When the close time passes, the house with the most submissions automatically wins the points — no manual action needed."}
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Schedule window (auto open/close by date & time) */}
                    <ScheduleWindow ctx={ctx} />

                    {/* Respondent identity visibility for non-admin viewers (registration/
                        organizer, plus the owning club/major president). super_admin/admin
                        always see identity — see canSeeRespondentIdentity. Gated on
                        canManageForms (same set allowed to create/edit this form at all) —
                        a president's choice here never goes live on its own: the review gate
                        (reviewStatus starts 'pending' for a president's create/edit, see
                        POST/PATCH .../form) means staff always reviews it before it's
                        visible to anyone. */}
                    <RespondentVisibility ctx={ctx} />

                    {/* S-form assignment — who may see & fill this skill form */}
                    <SFormAssignment ctx={ctx} />

                    {/* Sections & Questions */}
                    <SectionsEditor ctx={ctx} />

                    {/* Footer Actions */}
                    <BuilderFooter ctx={ctx} />
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                    
                    {/* Auto-award status banner — points are awarded automatically
                        when the scheduled close time passes; there is no manual
                        award/open/close action anymore. */}
                    <AutoAwardBanner ctx={ctx} />

                    {/* Stats Leaderboard Cards */}
                    <SubmissionStats ctx={ctx} />

                    {/* List of Submissions */}
                    <SubmissionsList ctx={ctx} />
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

      {/* Premium custom Confirm Modal */}
      <ConfirmModal ctx={ctx} />

    </>,
    document.body
  );
}
