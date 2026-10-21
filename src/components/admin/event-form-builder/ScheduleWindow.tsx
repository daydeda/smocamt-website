"use client";

import { AlertTriangle, Calendar } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function ScheduleWindow({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formClosesAt, formIsAwarded, formOpensAt, setFormClosesAt, setFormOpensAt, t } = ctx;
  return (
    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Calendar size={16} style={{ color: "var(--accent-primary)" }} />
                        <h4 style={{ fontSize: 14, fontWeight: 900 }}>{t.fbScheduleHeading || "Schedule"}</h4>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>
                        {t.fbScheduleDescPart1 || "Set when this form opens and closes (Bangkok time). Leave "}<b>{t.fbOpensAt || "Opens at"}</b>{t.fbScheduleDescPart2 || " blank to open immediately. "}<b>{t.fbClosesAt || "Closes at"}</b>{t.fbScheduleDescPart3 || " is required: when it passes, entries stop and the winning house is awarded automatically."}
                      </p>
                      {formIsAwarded && (
                        <p style={{ fontSize: 12, color: "var(--amber-700)", fontWeight: 700, background: "rgb(var(--amber-500-rgb) / 0.1)", border: "1px solid rgb(var(--amber-500-rgb) / 0.35)", borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          <span>{t.fbReopenWarningPart1 || "This form already closed and awarded its points. Setting "}<b>{t.fbClosesAt || "Closes at"}</b>{t.fbReopenWarningPart2 || " back to a future time re-opens it and "}<b>{t.fbReopenWarningBold || "takes the awarded points back"}</b>{t.fbReopenWarningPart3 || " from the winning house — they are re-awarded when it closes again."}</span>
                        </p>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 16 }}>
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.fbOpensAt || "Opens at"}</label>
                          <input
                            type="datetime-local"
                            lang="en-GB"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px" }}
                            value={formOpensAt}
                            onChange={(e) => setFormOpensAt(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label className="label" style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-secondary)" }}>{t.fbClosesAt || "Closes at"} <span style={{ color: "var(--red-500)" }}>*</span></label>
                          <input
                            type="datetime-local"
                            lang="en-GB"
                            className="input"
                            style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 16px", borderColor: !formClosesAt ? "var(--red-500)" : undefined }}
                            value={formClosesAt}
                            onChange={(e) => setFormClosesAt(e.target.value)}
                          />
                        </div>
                      </div>
                      {!formClosesAt && (
                        <p style={{ fontSize: 12, color: "var(--red-500)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} /> {t.fbValidationCloseRequired || "A close time is required so the form can auto-close and award points."}</p>
                      )}
                      {formOpensAt && formClosesAt && new Date(formClosesAt) <= new Date(formOpensAt) && (
                        <p style={{ fontSize: 12, color: "var(--red-500)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} /> {t.fbValidationCloseBeforeOpen || "Close time is before open time — students will never be able to submit."}</p>
                      )}
                    </div>
  );
}
