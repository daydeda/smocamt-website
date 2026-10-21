"use client";

import { Lock } from "lucide-react";
import { FORM_TYPE_LABELS, FORM_TYPE_COLORS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function FormSelector({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormId, allEventForms, canManageForms, loadFormIntoEditor, setActiveFormId, setShowNewFormPicker, t } = ctx;
  return (
    <div style={{ padding: "12px clamp(12px,4vw,32px)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
              {allEventForms.map((f) => {
                const c = FORM_TYPE_COLORS[f.formType] || FORM_TYPE_COLORS["K_post"];
                const isActive = f.id === activeFormId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { setShowNewFormPicker(false); loadFormIntoEditor(f); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 800,
                      cursor: "pointer", transition: "all 0.15s",
                      background: isActive ? c.bg : "var(--bg-surface)",
                      color: isActive ? c.text : "var(--text-secondary)",
                      border: isActive ? `1.5px solid ${c.border}` : "1.5px solid var(--border-subtle)",
                      boxShadow: isActive ? `0 0 0 2px ${c.border}` : "none",
                    }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 900, background: c.bg, color: c.text, padding: "1px 5px", borderRadius: 4 }}>
                      {FORM_TYPE_LABELS[f.formType] || f.formType}
                    </span>
                    <span style={{ maxWidth: 200, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "break-word", textAlign: "left", lineHeight: 1.3 }}>{f.title}</span>
                    {f.isAwarded && <Lock size={10} style={{ flexShrink: 0 }} />}
                    {!f.isActive && !f.isAwarded && <span style={{ fontSize: 10, opacity: 0.6 }}>●</span>}
                  </button>
                );
              })}
              {canManageForms && (
              <button
                type="button"
                onClick={() => { setShowNewFormPicker(true); setActiveFormId(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 800,
                  cursor: "pointer", background: "transparent",
                  color: "var(--accent-primary)", border: "1.5px dashed var(--accent-primary)",
                }}
              >
                {t.fbAddForm || "+ Add Form"}
              </button>
              )}
            </div>
  );
}
