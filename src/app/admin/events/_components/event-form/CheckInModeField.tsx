"use client";

import { QrCode } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChoiceFieldset, OptionRow } from "./FormControls";

export function CheckInModeField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, set, t } = ctx;
  const options = [
    { value: "qr" as const, label: t.adminEvfCheckInQr, desc: t.adminEvfCheckInQrDesc },
    { value: "evidence" as const, label: t.adminEvfCheckInEvidence, desc: t.adminEvfCheckInEvidenceDesc },
  ];
  return (
    <ChoiceFieldset legend={t.adminEvfCheckInMethod} icon={<QrCode size={16} />} hint={t.adminEvfCheckInMethodHint}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {options.map((opt) => (
          <OptionRow
            key={opt.value}
            type="radio"
            name="checkInMode"
            checked={formData.checkInMode === opt.value}
            onChange={() => set("checkInMode", opt.value)}
            title={opt.label}
            hint={opt.desc}
          />
        ))}
      </div>
    </ChoiceFieldset>
  );
}
