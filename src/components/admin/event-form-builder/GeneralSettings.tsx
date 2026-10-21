"use client";

import { FORM_TYPE_LABELS, FORM_TYPE_COLORS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function GeneralSettings({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormType, formDescription, formTitle, setFormDescription, setFormTitle, t } = ctx;
  return (
    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 16 }}>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <div className="field" style={{ flex: "1 1 260px" }}>
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.eventFormTitleLabel}</label>
                          <input
                            type="text"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px" }}
                            value={formTitle}
                            onChange={e => setFormTitle(e.target.value)}
                            placeholder="e.g. Event Satisfaction Survey"
                          />
                        </div>
                        {/* Form Type Badge — read-only, fixed when the form was created */}
                        {(() => {
                          const c = FORM_TYPE_COLORS[activeFormType] || FORM_TYPE_COLORS["K_post"];
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "8px 14px", borderRadius: 12, background: c.bg, border: `1px solid ${c.border}`, marginTop: 22 }}>
                              <span style={{ fontSize: 12, fontWeight: 900, color: c.text }}>{FORM_TYPE_LABELS[activeFormType] || activeFormType}</span>
                              <span style={{ fontSize: 11, color: c.text, opacity: 0.7 }}>
                                {activeFormType === "K_pre" ? (t.fbFormTypeNoAttendance || "No attendance required") : activeFormType === "S" ? (t.fbFormTypeAdminOnly || "Admin/staff only") : (t.fbFormTypeRequiresCheckin || "Requires check-in")}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="field">
                        <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.eventFormInstructionLabel}</label>
                        <textarea
                          className="input custom-scrollbar"
                          style={{ width: "100%", minHeight: 80, borderRadius: 12, padding: "12px 16px", resize: "vertical" }}
                          value={formDescription}
                          onChange={e => setFormDescription(e.target.value)}
                          placeholder="Helpful prompt text for students..."
                        />
                      </div>
                    </div>
  );
}
