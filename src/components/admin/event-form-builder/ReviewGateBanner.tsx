"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { InlineAlert } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function ReviewGateBanner({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormId, formReviewNote, formReviewSaving, formReviewStatus, isAttendanceOnly, reviewActiveForm, setRequestChangesNote, setRequestChangesOpen, t } = ctx;
  if (!(activeFormId && formReviewStatus === "pending")) return null;
  return (
    <InlineAlert tone="warning" title={t.fbReviewPendingBannerTitle}>
      <div className="flex flex-col gap-3">
        <p>{t.fbReviewPendingBannerDesc}</p>
        {formReviewNote && (
          <p className="rounded-xl px-3 py-2" style={{ background: "var(--bg-surface)", color: "var(--text-primary)" }}>
            <strong>{t.fbReviewNoteLabel}:</strong> {formReviewNote}
          </p>
        )}
        {!isAttendanceOnly && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={formReviewSaving} onClick={() => { setRequestChangesNote(""); setRequestChangesOpen(true); }}>
              <AlertTriangle size={14} aria-hidden="true" /> {t.fbReviewRequestChangesBtn}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={formReviewSaving} onClick={() => reviewActiveForm("approve")}>
              {formReviewSaving ? <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {formReviewSaving ? t.adminEvfWorking : t.fbReviewApproveBtn}
            </button>
          </div>
        )}
      </div>
    </InlineAlert>
  );
}
