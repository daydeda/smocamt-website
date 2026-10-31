"use client";

import { Field } from "@/components/admin/ui";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function PointPoolsFields({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, formData, set, t } = ctx;
  return (
    // A disabled fieldset locks both inputs for roles that may not edit points,
    // for keyboard and screen-reader users as well as the mouse.
    <fieldset disabled={!canEditRestrictedFields} className="m-0 grid min-w-0 grid-cols-1 gap-5 border-0 p-0 md:grid-cols-2">
      <Field label={t.eventPointsLabel} hint={canEditRestrictedFields ? t.eventHousePointsHint : t.eventStaffOnlyFieldHint}>
        {(p) => (
          <input
            {...p}
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            value={formData.pointsAwarded}
            onChange={(e) => set("pointsAwarded", Number(e.target.value))}
          />
        )}
      </Field>
      <Field label={t.eventIndividualPointsLabel} hint={canEditRestrictedFields ? t.eventIndividualPointsHint : t.eventStaffOnlyFieldHint}>
        {(p) => (
          <input
            {...p}
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            value={formData.individualPointsAwarded}
            onChange={(e) => set("individualPointsAwarded", Number(e.target.value))}
          />
        )}
      </Field>
    </fieldset>
  );
}
