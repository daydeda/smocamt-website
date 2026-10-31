"use client";

import { ShieldCheck } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { OptionRow } from "./FormControls";

export function CheckOutFields({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, set, t } = ctx;
  // Two-step check-in/check-out only exists for QR events; self-submitted
  // evidence events have no staff-scanned check-out at all.
  if (formData.checkInMode !== "qr") {
    return <p className="adm-field-hint">{t.adminEvfCheckOutEvidenceNote}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <OptionRow
        checked={formData.requireCheckOut}
        onChange={(checked) => set("requireCheckOut", checked)}
        icon={<ShieldCheck size={16} />}
        showState
        title={t.adminEvfRequireCheckOut}
        hint={t.adminEvfRequireCheckOutHint}
      />
      {/* Sub-option of requireCheckOut — only meaningful once that is on. Lets
          staff skip the mandatory proof photo for events where the in-person
          scan alone is trusted. See events.checkOutEvidenceRequired in schema.ts. */}
      {formData.requireCheckOut && (
        <div className="pl-4 sm:pl-8">
          <OptionRow
            checked={formData.checkOutEvidenceRequired}
            onChange={(checked) => set("checkOutEvidenceRequired", checked)}
            showState
            title={t.adminEvfCheckOutProof}
            hint={formData.checkOutEvidenceRequired ? t.adminEvfCheckOutProofOn : t.adminEvfCheckOutProofOff}
          />
        </div>
      )}
    </div>
  );
}
