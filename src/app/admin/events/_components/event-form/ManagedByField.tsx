"use client";

import { ShieldCheck } from "lucide-react";
import { InlineAlert } from "@/components/admin/ui";
import { type ParticipantRole, ROLE_LABELS, ALL_MAJORS } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChipCheck, ChoiceFieldset, SelectionSummary } from "./FormControls";

export function ManagedByField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, clubs, formData, setFormData, t } = ctx;
  const activeClubs = clubs.filter((c) => !c.isArchived);
  return (
    <ChoiceFieldset
      legend={t.adminEvfManagedBy}
      icon={<ShieldCheck size={16} />}
      hint={t.adminEvfManagedByHint}
      locked={!canEditRestrictedFields}
    >
      <div className="flex flex-wrap gap-2">
        {(["club_president", "major_president"] as const).map((role) => (
          <ChipCheck
            key={role}
            accent={role === "club_president" ? "var(--amber-500)" : "var(--cyan-500)"}
            checked={formData.managedByRoles.includes(role)}
            onChange={(checked) => {
              const current = formData.managedByRoles;
              const next = checked ? (current.includes(role) ? current : [...current, role]) : current.filter((r) => r !== role);
              setFormData({ ...formData, managedByRoles: next });
            }}
          >
            {ROLE_LABELS[role as ParticipantRole]}
          </ChipCheck>
        ))}
      </div>
      <SelectionSummary restricted={formData.managedByRoles.length > 0}>
        {formData.managedByRoles.length === 0
          ? t.adminEvfManagedStaffOnly
          : t.adminEvfManagedByList.replace("{list}", formData.managedByRoles.map((r) => ROLE_LABELS[r as ParticipantRole] || r).join(", "))}
      </SelectionSummary>

      {/* Owner club(s)/major(s) — WHICH club_president/major_president may
          actually manage this event (see EventScopeService). Without an owner
          assigned here, the event stays hidden from every president even though
          managedByRoles marks it as president-managed. */}
      {formData.managedByRoles.includes("club_president") && (
        <ChoiceFieldset legend={t.adminEvfOwningClubs}>
          {activeClubs.length === 0 ? (
            <p className="adm-field-hint">{t.adminEvfNoClubs}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeClubs.map((club) => (
                <ChipCheck
                  key={club.id}
                  accent="var(--amber-500)"
                  checked={formData.ownerClubIds.includes(club.id)}
                  onChange={(checked) => {
                    const current = formData.ownerClubIds;
                    const next = checked ? (current.includes(club.id) ? current : [...current, club.id]) : current.filter((id) => id !== club.id);
                    setFormData({ ...formData, ownerClubIds: next });
                  }}
                >
                  {club.name}
                </ChipCheck>
              ))}
            </div>
          )}
          {formData.ownerClubIds.length === 0 && <InlineAlert tone="warning">{t.adminEvfNoClubAssigned}</InlineAlert>}
        </ChoiceFieldset>
      )}
      {formData.managedByRoles.includes("major_president") && (
        <ChoiceFieldset legend={t.adminEvfOwningMajors}>
          <div className="flex flex-wrap gap-2">
            {ALL_MAJORS.map((major) => (
              <ChipCheck
                key={major}
                accent="var(--cyan-500)"
                checked={formData.ownerMajors.includes(major)}
                onChange={(checked) => {
                  const current = formData.ownerMajors;
                  const next = checked ? (current.includes(major) ? current : [...current, major]) : current.filter((m) => m !== major);
                  setFormData({ ...formData, ownerMajors: next });
                }}
              >
                {major}
              </ChipCheck>
            ))}
          </div>
          {formData.ownerMajors.length === 0 && <InlineAlert tone="warning">{t.adminEvfNoMajorAssigned}</InlineAlert>}
        </ChoiceFieldset>
      )}
    </ChoiceFieldset>
  );
}
