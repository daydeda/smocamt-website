"use client";

import { Field, Panel } from "@/components/admin/ui";
import { FORM_TYPE_LABELS, FORM_TYPE_COLORS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function GeneralSettings({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormType, formDescription, formTitle, setFormDescription, setFormTitle, t } = ctx;
  const c = FORM_TYPE_COLORS[activeFormType] || FORM_TYPE_COLORS["K_post"];
  const typeNote =
    activeFormType === "K_pre" ? t.fbFormTypeNoAttendance
    : activeFormType === "S" ? t.fbFormTypeAdminOnly
    : t.fbFormTypeRequiresCheckin;
  return (
    <Panel title={t.adminEvfSecFormBasics}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-4">
          <Field className="min-w-60 flex-1" label={t.eventFormTitleLabel}>
            {(p) => (
              <input {...p} type="text" className="input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="e.g. Event Satisfaction Survey" />
            )}
          </Field>
          {/* Form type: read-only, fixed when the form was created */}
          <div className="field">
            <span className="adm-field-label">{t.adminEvfFormType}</span>
            <div className="flex flex-col rounded-xl px-3 py-2" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{FORM_TYPE_LABELS[activeFormType] || activeFormType}</span>
              <span style={{ fontSize: 12 }}>{typeNote}</span>
            </div>
          </div>
        </div>
        <Field label={t.eventFormInstructionLabel} hint={t.adminEvfInstructionHint}>
          {(p) => (
            <textarea
              {...p}
              className="input custom-scrollbar"
              style={{ minHeight: 88, resize: "vertical" }}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Helpful prompt text for students..."
            />
          )}
        </Field>
      </div>
    </Panel>
  );
}
