"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function ReviewGateBanner({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormId, formReviewNote, formReviewSaving, formReviewStatus, isAttendanceOnly, reviewActiveForm, setRequestChangesNote, setRequestChangesOpen, t } = ctx;
  return (
    <>{activeFormId && formReviewStatus === "pending" && (
                  <div className="animate-fade-in" style={{
                    background: "rgb(var(--amber-500-rgb) / 0.08)",
                    border: "1px solid rgb(var(--amber-500-rgb) / 0.25)",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 28,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <AlertTriangle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <p style={{ fontWeight: 800, fontSize: 13, color: "var(--amber-500)" }}>{t.fbReviewPendingBannerTitle || "Awaiting review"}</p>
                        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>{t.fbReviewPendingBannerDesc}</p>
                      </div>
                    </div>
                    {formReviewNote && (
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", background: "var(--bg-elevated)", borderRadius: 10, padding: "8px 12px" }}>
                        <strong>{t.fbReviewNoteLabel || "Note from staff"}:</strong> {formReviewNote}
                      </p>
                    )}
                    {!isAttendanceOnly && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={formReviewSaving}
                          onClick={() => reviewActiveForm("approve")}
                        >
                          {formReviewSaving ? <div className="spinner w-3 h-3 border-2" /> : <CheckCircle2 size={14} />} {t.fbReviewApproveBtn || "Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={formReviewSaving}
                          onClick={() => { setRequestChangesNote(""); setRequestChangesOpen(true); }}
                        >
                          <AlertTriangle size={14} /> {t.fbReviewRequestChangesBtn || "Request Changes"}
                        </button>
                      </div>
                    )}
                  </div>
                )}</>
  );
}
