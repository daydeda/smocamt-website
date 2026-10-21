"use client";

import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function RespondentVisibility({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { canManageForms, formShowRespondentIdentity, isAttendanceOnly, setFormShowRespondentIdentity, t } = ctx;
  return (
    <div style={{ background: "var(--bg-elevated)", padding: 24, borderRadius: 24, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12, opacity: canManageForms ? 1 : 0.5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {formShowRespondentIdentity ? <Eye size={16} style={{ color: "var(--accent-primary)" }} /> : <EyeOff size={16} style={{ color: "var(--accent-primary)" }} />}
                        <h4 style={{ fontSize: 14, fontWeight: 900 }}>{t.fbIdentityToggleLabel || "Show respondent identity"}</h4>
                      </div>
                      <div
                        onClick={() => { if (canManageForms) setFormShowRespondentIdentity((v) => !v); }}
                        style={{
                          minHeight: 48,
                          background: "var(--bg-surface)",
                          borderRadius: 16,
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 16px",
                          cursor: canManageForms ? "pointer" : "not-allowed",
                          border: formShowRespondentIdentity ? "1px solid var(--accent-primary)" : "1px solid transparent",
                          transition: "all 0.2s"
                        }}
                      >
                        <div style={{
                          width: 24, height: 24, flexShrink: 0, borderRadius: 6,
                          border: "2px solid var(--border-medium)",
                          background: formShowRespondentIdentity ? "var(--accent-primary)" : "transparent",
                          borderColor: formShowRespondentIdentity ? "var(--accent-primary)" : "var(--border-medium)",
                          display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s"
                        }}>
                          {formShowRespondentIdentity && <CheckCircle2 size={16} color="white" />}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                          {!canManageForms
                            ? (t.eventStaffOnlyFieldHint || "Editable by admin, registration, and organizer roles only.")
                            : formShowRespondentIdentity ? (t.fbIdentityToggleHintOn || "Registration/organizer viewers will see who submitted each response. Super-admins/admins always do.") : (t.fbIdentityToggleHintOff || "Registration/organizer viewers see anonymized responses — no name, student ID, or contact info. Super-admins/admins always see full identity.")}
                        </span>
                      </div>
                      {isAttendanceOnly && (
                        <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, lineHeight: 1.4 }}>
                          {t.fbIdentityPresidentReviewHint || "Staff reviews your choice before this form goes live — it won't be visible to anyone until approved."}
                        </p>
                      )}
                    </div>
  );
}
