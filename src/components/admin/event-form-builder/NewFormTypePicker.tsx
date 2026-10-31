"use client";

import { Check } from "lucide-react";
import { FORM_TYPE_LABELS, FORM_TYPE_COLORS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function NewFormTypePicker({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { allEventForms, canManageForms, formLoading, showNewFormPicker, startNewForm, t } = ctx;
  if (!(canManageForms && showNewFormPicker && !formLoading)) return null;
  return (
    <div className="mb-4 rounded-2xl p-4" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
        {t.fbSelectFormTypePicker}
      </p>
      <div className="flex flex-wrap gap-3">
        {(["K_pre", "K_post", "A", "S", "F"] as const).map((type) => {
          const c = FORM_TYPE_COLORS[type];
          const alreadyExists = allEventForms.some((f) => f.formType === type);
          return (
            <button
              key={type}
              type="button"
              disabled={alreadyExists}
              onClick={() => startNewForm(type)}
              title={alreadyExists ? t.fbFormTypeAlreadyExists : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4"
              style={{
                fontSize: 14, fontWeight: 700,
                cursor: alreadyExists ? "not-allowed" : "pointer", opacity: alreadyExists ? 0.6 : 1,
                background: c.bg, color: c.text, border: `1.5px solid ${c.border}`,
              }}
            >
              {FORM_TYPE_LABELS[type]}
              {alreadyExists && (
                <span className="inline-flex items-center gap-1" style={{ fontSize: 12 }}>
                  <Check size={12} aria-hidden="true" />{t.adminEvfFormExists}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
