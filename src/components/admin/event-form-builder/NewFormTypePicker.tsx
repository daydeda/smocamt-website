"use client";

import { FORM_TYPE_LABELS, FORM_TYPE_COLORS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function NewFormTypePicker({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { allEventForms, canManageForms, formLoading, showNewFormPicker, startNewForm, t } = ctx;
  return (
    <>{canManageForms && showNewFormPicker && !formLoading && (
              <div style={{ padding: "20px clamp(12px,4vw,32px)", background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 12 }}>
                  {t.fbSelectFormTypePicker || "Select the type of form to create for this event:"}
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(["K_pre", "K_post", "A", "S", "F"] as const).map((type) => {
                    const c = FORM_TYPE_COLORS[type];
                    const alreadyExists = allEventForms.some((f) => f.formType === type);
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={alreadyExists}
                        onClick={() => startNewForm(type)}
                        style={{
                          padding: "10px 20px", borderRadius: 14, fontSize: 13, fontWeight: 800,
                          cursor: alreadyExists ? "not-allowed" : "pointer", opacity: alreadyExists ? 0.4 : 1,
                          background: c.bg, color: c.text, border: `1.5px solid ${c.border}`,
                          transition: "all 0.15s",
                        }}
                        title={alreadyExists ? (t.fbFormTypeAlreadyExists || "A form of this type already exists for this event") : ""}
                      >
                        {FORM_TYPE_LABELS[type]}
                        {alreadyExists && " ✓"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}</>
  );
}
