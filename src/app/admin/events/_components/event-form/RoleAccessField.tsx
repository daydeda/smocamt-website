"use client";

import { Users } from "lucide-react";
import { ALL_PARTICIPANT_ROLES, type ParticipantRole, ROLE_LABELS } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChipCheck, ChoiceFieldset, SelectionSummary } from "./FormControls";

// Accent per role. Colour only decorates; selection is also shown by the tick box and the summary line.
const ROLE_ACCENTS: Record<string, string> = {
  student: "var(--indigo-500)",
  staff: "var(--teal-500)",
  smo: "var(--violet-500)",
  anusmo: "var(--pink-500)",
  club_president: "var(--amber-500)",
  major_president: "var(--cyan-500)",
};

export function RoleAccessField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, formData, setFormData, t } = ctx;
  return (
    <ChoiceFieldset
      legend={t.adminEvfRoleAccess}
      icon={<Users size={16} />}
      hint={t.adminEvfRoleAccessHint}
      locked={!canEditRestrictedFields}
    >
      <div className="flex flex-wrap gap-2">
        {ALL_PARTICIPANT_ROLES.map((role) => (
          <ChipCheck
            key={role}
            accent={ROLE_ACCENTS[role]}
            checked={formData.allowedRoles.includes(role)}
            onChange={(checked) => {
              const current = formData.allowedRoles;
              const next = checked ? (current.includes(role) ? current : [...current, role]) : current.filter((r) => r !== role);
              setFormData({ ...formData, allowedRoles: next });
            }}
          >
            {ROLE_LABELS[role as ParticipantRole]}
          </ChipCheck>
        ))}
      </div>
      <SelectionSummary restricted={formData.allowedRoles.length > 0}>
        {formData.allowedRoles.length === 0
          ? t.adminEvfOpenRoles
          : t.adminEvfRestrictedTo.replace("{list}", formData.allowedRoles.map((r) => ROLE_LABELS[r as ParticipantRole] || r).join(", "))}
      </SelectionSummary>
    </ChoiceFieldset>
  );
}
