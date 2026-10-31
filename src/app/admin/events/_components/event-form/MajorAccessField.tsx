"use client";

import { Users } from "lucide-react";
import { ALL_MAJORS, MAJOR_LABELS } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChipCheck, ChoiceFieldset, SelectionSummary } from "./FormControls";

export function MajorAccessField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, formData, setFormData, t } = ctx;
  return (
    <ChoiceFieldset
      legend={t.adminEvfMajorAccess}
      icon={<Users size={16} />}
      hint={t.adminEvfMajorAccessHint}
      locked={!canEditRestrictedFields}
    >
      <div className="flex flex-wrap gap-2">
        {ALL_MAJORS.map((major) => (
          <ChipCheck
            key={major}
            title={MAJOR_LABELS[major]}
            checked={formData.allowedMajors.includes(major)}
            onChange={(checked) => {
              const current = formData.allowedMajors;
              const next = checked ? (current.includes(major) ? current : [...current, major]) : current.filter((m) => m !== major);
              setFormData({ ...formData, allowedMajors: next });
            }}
          >
            {major}
          </ChipCheck>
        ))}
      </div>
      <SelectionSummary restricted={formData.allowedMajors.length > 0}>
        {formData.allowedMajors.length === 0
          ? t.adminEvfOpenMajors
          : t.adminEvfRestrictedTo.replace("{list}", formData.allowedMajors.join(", "))}
      </SelectionSummary>
    </ChoiceFieldset>
  );
}
