"use client";

import { Eye, EyeOff } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { OptionRow } from "@/app/admin/events/_components/event-form/FormControls";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function RespondentVisibility({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { canManageForms, formShowRespondentIdentity, isAttendanceOnly, setFormShowRespondentIdentity, t } = ctx;
  return (
    <Panel title={t.adminEvfSecPrivacy} description={t.adminEvfSecPrivacyDesc}>
      <div className="flex flex-col gap-3">
        <OptionRow
          checked={formShowRespondentIdentity}
          disabled={!canManageForms}
          onChange={(checked) => setFormShowRespondentIdentity(checked)}
          icon={formShowRespondentIdentity ? <Eye size={16} /> : <EyeOff size={16} />}
          showState
          title={t.fbIdentityToggleLabel}
          hint={
            !canManageForms
              ? t.eventStaffOnlyFieldHint
              : formShowRespondentIdentity ? t.fbIdentityToggleHintOn : t.fbIdentityToggleHintOff
          }
        />
        {isAttendanceOnly && <p className="adm-field-hint">{t.fbIdentityPresidentReviewHint}</p>}
      </div>
    </Panel>
  );
}
