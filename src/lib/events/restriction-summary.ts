// Pure helpers for the "you can't access this event" page (/e/<id>). They read the
// same EligibilityItem / Viewer shapes as isEligibleFor, so the explanation the
// visitor sees can never disagree with the access check that hid the event.

import {
  getAllowedEventYears,
  isEligibleForEventYear,
  type EligibilityItem,
  type Viewer,
} from "@/lib/access/event-access";

export type RestrictionKey = "nationality" | "roles" | "majors" | "clubs" | "years";

export type EventRestrictionSummary = {
  /** Only one nationality may join; null = both (no restriction). */
  nationality: "thai" | "intl" | null;
  roles: string[];
  majors: string[];
  /** Club UUIDs; names are resolved by the caller. */
  clubIds: string[];
  years: number[];
};

/** The requirements an event sets. Empty/null fields mean "no restriction". */
export function summarizeRestrictions(item: EligibilityItem): EventRestrictionSummary {
  const targetThai = item.targetThai ?? true;
  const targetIntl = item.targetInternational ?? true;
  // Both unchecked means "anyone" (same rule as isEligibleFor).
  const open = !targetThai && !targetIntl;
  const thai = open || targetThai;
  const intl = open || targetIntl;
  return {
    nationality: thai && !intl ? "thai" : intl && !thai ? "intl" : null,
    roles: item.allowedRoles ?? [],
    majors: item.allowedMajors ?? [],
    clubIds: item.allowedClubs ?? [],
    years: getAllowedEventYears(item),
  };
}

/** Which requirements this viewer fails. Empty = the viewer qualifies. Mirrors isEligibleFor. */
export function unmetRestrictions(item: EligibilityItem, viewer: Viewer): RestrictionKey[] {
  const s = summarizeRestrictions(item);
  const unmet: RestrictionKey[] = [];
  if (s.nationality === "thai" && !viewer.isThai) unmet.push("nationality");
  if (s.nationality === "intl" && !viewer.isIntl) unmet.push("nationality");
  if (!viewer.isAdminRole) {
    if (s.roles.length && !viewer.effectiveRoles.some((r) => s.roles.includes(r))) unmet.push("roles");
    if (s.majors.length && (!viewer.userMajor || !s.majors.includes(viewer.userMajor))) unmet.push("majors");
    if (s.clubIds.length && !viewer.clubIds.some((id) => s.clubIds.includes(id))) unmet.push("clubs");
    if (!isEligibleForEventYear(item, viewer.yearOfStudy)) unmet.push("years");
  }
  return unmet;
}
