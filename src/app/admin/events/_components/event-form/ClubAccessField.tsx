"use client";

import { Building2 } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChipCheck, ChoiceFieldset, SelectionSummary } from "./FormControls";

export function ClubAccessField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, clubs, formData, setFormData, t } = ctx;
  const activeClubs = clubs.filter((c) => !c.isArchived);
  return (
    <ChoiceFieldset
      legend={t.adminEvfClubAccess}
      icon={<Building2 size={16} />}
      hint={t.adminEvfClubAccessHint}
      locked={!canEditRestrictedFields}
    >
      {activeClubs.length === 0 ? (
        <p className="adm-field-hint">{t.adminEvfNoClubs}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {activeClubs.map((club) => (
            <ChipCheck
              key={club.id}
              accent="var(--violet-500)"
              checked={formData.allowedClubs.includes(club.id)}
              onChange={(checked) => {
                const current = formData.allowedClubs;
                const next = checked ? (current.includes(club.id) ? current : [...current, club.id]) : current.filter((id) => id !== club.id);
                setFormData({ ...formData, allowedClubs: next });
              }}
            >
              {club.name}
            </ChipCheck>
          ))}
        </div>
      )}
      <SelectionSummary restricted={formData.allowedClubs.length > 0}>
        {formData.allowedClubs.length === 0
          ? t.adminEvfOpenClubs
          : t.adminEvfRestrictedToClubs.replace("{list}", clubs.filter((c) => formData.allowedClubs.includes(c.id)).map((c) => c.name).join(", "))}
      </SelectionSummary>
    </ChoiceFieldset>
  );
}
