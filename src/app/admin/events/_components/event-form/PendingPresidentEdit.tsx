"use client";

import { CheckCircle2, X, AlertTriangle } from "lucide-react";
import { useConfirm } from "@/components/admin/ui";
import { formatPendingDetailsDiff } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function PendingPresidentEdit({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { approveEventDetails, detailsReviewToggling, discardPendingDetails, editingId, events, formData, isAttendanceOnly, t } = ctx;
  const confirm = useConfirm();
  const editingEvent = events.find((e) => e.id === editingId);

  if (
    isAttendanceOnly || !editingId || formData.detailsReviewStatus !== "pending" ||
    !(formData.managedByRoles.includes("club_president") || formData.managedByRoles.includes("major_president")) ||
    !editingEvent?.pendingDetailsChanges
  ) {
    return null;
  }

  const diffRows = formatPendingDetailsDiff(editingEvent.pendingDetailsChanges, editingEvent, t);

  const onDiscard = async () => {
    const ok = await confirm({
      title: t.adminEvfDiscardPendingTitle,
      message: t.adminEvfDiscardPendingMsg.replace("{title}", editingEvent.title),
      confirmLabel: t.adminEvfDiscardPendingBtn,
      tone: "danger",
    });
    if (ok) discardPendingDetails();
  };

  return (
    <section aria-labelledby="pending-edit-title" className="adm-inline-alert adm-inline-alert-warning flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div className="min-w-0">
            <p id="pending-edit-title" style={{ fontWeight: 700 }}>{t.eventDetailsPendingStaffLabel}</p>
            <p>{t.eventDetailsPendingStaffDesc}</p>
            {editingEvent.pendingSubmitter && (
              <p className="adm-field-hint" style={{ marginTop: 6 }}>
                {t.eventDetailsPendingSubmittedByLabel} {editingEvent.pendingSubmitter.name}
                {editingEvent.pendingDetailsSubmittedAt && ` · ${new Date(editingEvent.pendingDetailsSubmittedAt).toLocaleString("en-GB")}`}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={detailsReviewToggling} onClick={onDiscard}>
            {detailsReviewToggling ? <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} /> : <X size={14} aria-hidden="true" />}
            {t.eventDetailsDiscardBtn}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={detailsReviewToggling} onClick={approveEventDetails}>
            {detailsReviewToggling ? <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {t.eventDetailsApproveBtn}
          </button>
        </div>
      </div>
      {diffRows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 rounded-[12px] p-3" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", fontSize: 13 }}>
          {diffRows.map((row) => (
            <li key={row.key} style={{ lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong> {row.oldText} <span aria-label={t.adminEvfChangedTo}>→</span> {row.newText}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
