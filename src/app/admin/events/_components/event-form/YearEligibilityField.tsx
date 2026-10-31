"use client";

import { GraduationCap } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChipCheck, ChoiceFieldset, SelectionSummary } from "./FormControls";

export function YearEligibilityField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, setFormData, t } = ctx;
  const years = [...formData.allowedYears].sort((a, b) => a - b);
  return (
    <ChoiceFieldset legend={t.allowedStudentYears} icon={<GraduationCap size={16} />} hint={t.allowedStudentYearsHint}>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((year) => (
          <ChipCheck
            key={year}
            checked={formData.allowedYears.includes(year)}
            onChange={(checked) => {
              setFormData((prev) => ({
                ...prev,
                allowedYears: checked
                  ? [...prev.allowedYears, year].sort((a, b) => a - b)
                  : prev.allowedYears.filter((value) => value !== year),
              }));
            }}
          >
            {t.studentYearLabel.replace("{year}", String(year))}
          </ChipCheck>
        ))}
      </div>
      <SelectionSummary restricted={years.length > 0}>
        {years.length === 0
          ? t.allStudentYears
          : t.adminEvfRestrictedTo.replace("{list}", years.map((y) => t.studentYearLabel.replace("{year}", String(y))).join(", "))}
      </SelectionSummary>
    </ChoiceFieldset>
  );
}
