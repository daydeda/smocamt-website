"use client";

import { Lock, Plus } from "lucide-react";
import { FORM_TYPE_LABELS, FORM_TYPE_COLORS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function FormSelector({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormId, allEventForms, canManageForms, loadFormIntoEditor, setActiveFormId, setShowNewFormPicker, t } = ctx;
  if (allEventForms.length === 0 && !canManageForms) return null;
  return (
    <div role="group" aria-label={t.adminEvfFormsOfEvent} className="flex flex-wrap items-center gap-2 pb-3">
      {allEventForms.map((f) => {
        const c = FORM_TYPE_COLORS[f.formType] || FORM_TYPE_COLORS["K_post"];
        const isActive = f.id === activeFormId;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => { setShowNewFormPicker(false); loadFormIntoEditor(f); }}
            className="flex min-h-11 items-center gap-2 rounded-full px-3 py-1.5"
            style={{
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: isActive ? c.bg : "var(--bg-surface)",
              color: isActive ? c.text : "var(--text-secondary)",
              border: isActive ? `2px solid ${c.border}` : "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, background: c.bg, color: c.text, padding: "0 6px", borderRadius: 6 }}>
              {FORM_TYPE_LABELS[f.formType] || f.formType}
            </span>
            <span style={{ maxWidth: 220, textAlign: "left", lineHeight: 1.4, overflowWrap: "anywhere" }}>{f.title}</span>
            {f.isAwarded && (
              <span className="inline-flex items-center gap-1" style={{ fontSize: 12 }}>
                <Lock size={12} aria-hidden="true" />{t.adminEvfFormAwarded}
              </span>
            )}
            {!f.isActive && !f.isAwarded && <span style={{ fontSize: 12 }}>{t.adminEvfFormInactive}</span>}
          </button>
        );
      })}
      {canManageForms && (
        <button
          type="button"
          onClick={() => { setShowNewFormPicker(true); setActiveFormId(null); }}
          className="flex min-h-11 items-center gap-1.5 rounded-full px-4 py-1.5"
          style={{ fontSize: 13, fontWeight: 700, cursor: "pointer", background: "transparent", color: "var(--accent-primary)", border: "1.5px dashed var(--accent-primary)" }}
        >
          <Plus size={14} aria-hidden="true" />
          {t.adminEvfAddForm}
        </button>
      )}
    </div>
  );
}
