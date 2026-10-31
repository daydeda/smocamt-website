"use client";

import { DoorOpen } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { OptionRow } from "./FormControls";

export function WalkInsFields({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, setFormData, t } = ctx;
  return (
    <OptionRow
      checked={formData.walkInsOnly}
      onChange={(nextVal) => {
        setFormData({
          ...formData,
          walkInsOnly: nextVal,
          ...(nextVal && { walkInsEnabled: true }),
        });
      }}
      icon={<DoorOpen size={16} />}
      showState
      title={t.walkInsOnlyToggleLabel}
      hint={t.walkInsOnlyToggleHint}
    />
  );
}
