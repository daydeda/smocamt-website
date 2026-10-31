"use client";

import { Calendar } from "lucide-react";
import { splitIntoDailySessions } from "@/lib/events/event-schema";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChoiceFieldset, OptionRow } from "./FormControls";

export function RegistrationModeField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, registrationMode, sessions, setRegistrationMode, setSessions, t } = ctx;

  // Not flagged "recommended" — "once" is the only supported mode today.
  // 'per_session' (separate sign-up each day) is intentionally hidden: the
  // student registration flow has no per-day path yet, so picking it would
  // create an event where Day-2 pre-registrants get pushed into the walk-in
  // path. Re-enable once per-session registration ships. See
  // docs/features/multi-day-checkin-implementation.md §10.
  const MODE = "once" as const;
  const active = registrationMode === MODE;

  const toggle = () => {
    if (active) {
      // Turn off — collapse back to a single session row mirroring the main
      // start/end, matching the registrationMode === null convention.
      const first = sessions[0];
      setRegistrationMode(null);
      setSessions([{ title: first?.title ?? "", startTime: formData.startTime, endTime: formData.endTime, quotaWalkIn: first?.quotaWalkIn ?? null, evidenceNonce: first?.evidenceNonce ?? null, evidencePrompt: first?.evidencePrompt ?? null }]);
    } else {
      setRegistrationMode(MODE);
      // The sole row still mirrors the main start/end. If that range itself
      // spans multiple calendar days, split it into one row per day right away
      // — otherwise "Day 1" would silently cover the whole multi-day range as
      // one session (see sessionSpansTooLong).
      const first = sessions[0];
      if (first?.startTime && first?.endTime) {
        const split = splitIntoDailySessions(first.startTime, first.endTime);
        if (split.length > 1) {
          setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: first.quotaWalkIn ?? null, evidenceNonce: first.evidenceNonce ?? null, evidencePrompt: first.evidencePrompt ?? null })));
        }
      }
    }
  };

  return (
    <ChoiceFieldset
      legend={t.registrationModeLabel}
      icon={<Calendar size={16} />}
      badge={<span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", border: "1px solid var(--border-medium)", borderRadius: 999, padding: "0 8px" }}>{t.registrationModeOptional}</span>}
      hint={t.registrationModeHint}
    >
      <OptionRow checked={active} onChange={toggle} showState title={t.registrationModeOnce} hint={t.registrationModeOnceDesc} />
    </ChoiceFieldset>
  );
}
