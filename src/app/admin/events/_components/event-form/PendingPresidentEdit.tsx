"use client";

import { CheckCircle2, X, AlertTriangle } from "lucide-react";
import { formatPendingDetailsDiff } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function PendingPresidentEdit({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { approveEventDetails, detailsReviewToggling, discardPendingDetails, editingId, events, formData, isAttendanceOnly, t } = ctx;
  return (
    <>{!isAttendanceOnly && editingId && formData.detailsReviewStatus === "pending" &&
            (formData.managedByRoles.includes("club_president") || formData.managedByRoles.includes("major_president")) &&
            events.find((e) => e.id === editingId)?.pendingDetailsChanges && (() => {
            const editingEvent = events.find((e) => e.id === editingId);
            const diffRows = editingEvent?.pendingDetailsChanges
              ? formatPendingDetailsDiff(editingEvent.pendingDetailsChanges, editingEvent, t)
              : [];
            return (
              <div style={{
                display: "flex", flexDirection: "column", gap: 12,
                background: "rgb(var(--amber-500-rgb) / 0.08)", border: "1px solid rgb(var(--amber-500-rgb) / 0.25)",
                borderRadius: 16, padding: "16px 20px", marginBottom: 24,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <AlertTriangle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <p style={{ fontWeight: 800, fontSize: 13, color: "var(--amber-500)" }}>
                        {t.eventDetailsPendingStaffLabel || "President edited this event"}
                      </p>
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>
                        {t.eventDetailsPendingStaffDesc || "The club/major president proposed the changes below. The live event is unaffected until you approve them."}
                      </p>
                      {editingEvent?.pendingSubmitter && (
                        <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
                          {t.eventDetailsPendingSubmittedByLabel || "Submitted by:"} {editingEvent.pendingSubmitter.name}
                          {editingEvent.pendingDetailsSubmittedAt && ` · ${new Date(editingEvent.pendingDetailsSubmittedAt).toLocaleString("en-GB")}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: "transparent", color: "var(--amber-500)", border: "1px solid rgb(var(--amber-500-rgb) / 0.4)",
                      }}
                      disabled={detailsReviewToggling}
                      onClick={discardPendingDetails}
                    >
                      {detailsReviewToggling ? <div className="spinner w-3 h-3 border-2" /> : <X size={14} />}
                      {t.eventDetailsDiscardBtn || "Discard"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: "var(--amber-500)", color: "var(--text-on-color)", border: "none",
                        boxShadow: "0 2px 8px rgb(var(--amber-500-rgb) / 0.35)",
                      }}
                      disabled={detailsReviewToggling}
                      onClick={approveEventDetails}
                    >
                      {detailsReviewToggling ? <div className="spinner w-3 h-3 border-2" /> : <CheckCircle2 size={14} />}
                      {t.eventDetailsApproveBtn || "Approve changes"}
                    </button>
                  </div>
                </div>
                {diffRows.length > 0 && (
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px",
                  }}>
                    {diffRows.map((row) => (
                      <p key={row.key} style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                        <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong>{" "}
                        {row.oldText} <span style={{ color: "var(--amber-500)", fontWeight: 700 }}>→</span> {row.newText}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}</>
  );
}
