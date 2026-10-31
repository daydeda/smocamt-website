"use client";

import { Field, Panel, StatusBadge, type Tone } from "@/components/admin/ui";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

// House + individual point rewards and the read-only lifecycle status.
export function RewardsSettings({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { formClosesAt, formIndividualPoints, formIsAwarded, formOpensAt, formPoints, setFormIndividualPoints, setFormPoints, t } = ctx;

  // Read-only lifecycle status. There is no manual open/close anymore — the
  // schedule window drives everything, and points auto-award once the close
  // time passes.
  const now = new Date();
  const opens = formOpensAt ? new Date(formOpensAt) : null;
  const closes = formClosesAt ? new Date(formClosesAt) : null;
  let tone: Tone = "success";
  let label = t.fbStatusOpenForEntries;
  if (formIsAwarded) {
    tone = "success"; label = t.fbStatusFinalizedAwarded;
  } else if (closes && now > closes) {
    tone = "neutral"; label = t.fbStatusClosedAutoAward;
  } else if (opens && now < opens) {
    tone = "info"; label = t.fbStatusScheduledNotOpen;
  }

  return (
    <Panel title={t.adminEvfSecRewards} description={t.adminEvfSecRewardsDesc}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t.fbHousePointsReward} hint={t.fbWinningHouseGetsPoints}>
            {(p) => (
              <input {...p} type="number" inputMode="numeric" min={0} className="input" value={formPoints} onChange={(e) => setFormPoints(Math.max(0, parseInt(e.target.value) || 0))} />
            )}
          </Field>
          <Field label={t.fbIndividualPointsReward} hint={t.fbEachSubmitterGetsPoints}>
            {(p) => (
              <input {...p} type="number" inputMode="numeric" min={0} className="input" value={formIndividualPoints} onChange={(e) => setFormIndividualPoints(Math.max(0, parseInt(e.target.value) || 0))} />
            )}
          </Field>
        </div>
        <div className="flex flex-col items-start gap-2">
          <p className="adm-field-label">{t.fbStatusPrefix}</p>
          <StatusBadge tone={tone}>{label}</StatusBadge>
          <p className="adm-field-hint">{t.fbStatusDesc}</p>
        </div>
      </div>
    </Panel>
  );
}
