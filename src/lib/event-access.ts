// Shared event/calendar visibility predicate.
//
// This is the SINGLE source of truth for "may this viewer see this item?", used
// by both /api/events and the calendar (/api/calendar + the .ics feed). Events
// and calendar_entries share identical visibility columns (allowedRoles,
// allowedMajors, targetThai, targetInternational), so they share this logic —
// calendar visibility matches event visibility by construction.
//
// NOTE: this does NOT include the "always show events I'm registered for"
// attendance bypass — that is event-specific and stays in /api/events. Calendar
// entries have no attendance concept.

// Admin roles bypass all role/major/audience restrictions.
const ADMIN_ROLES = ["super_admin", "admin", "registration", "organizer"];

export interface EligibilityItem {
  allowedRoles?: string[] | null;
  allowedMajors?: string[] | null;
  /** Club UUIDs a viewer must belong to (any club_members role) — see events.allowedClubs. */
  allowedClubs?: string[] | null;
  targetThai?: boolean | null;
  targetInternational?: boolean | null;
  /** When true, only first-year students (current intake prefix) are eligible. */
  firstYearOnly?: boolean | null;
}

export interface Viewer {
  isAdminRole: boolean;
  /** roles with professor/officer normalized to "staff" */
  effectiveRoles: string[];
  userMajor: string | null;
  isThai: boolean;
  isIntl: boolean;
  /** Whether the viewer's student id belongs to the current first-year intake. */
  isFirstYear: boolean;
  /** Club UUIDs the viewer belongs to (any club_members role) — see ClubsService.getMemberClubIds. */
  clubIds: string[];
}

/**
 * The student-id prefix that marks the CURRENT first-year intake. CMU ids begin
 * with the Buddhist-era (BE = CE + 543) admission year mod 100 — e.g. the 2026
 * intake (BE 2569) has ids starting with "69". This is derived from the date so
 * it stays correct each year without a code change.
 *
 * The academic year rolls over mid-year: the new cohort is admitted around
 * June/July, so before June we still treat the previous calendar year's cohort
 * as the first-years (their successors don't exist yet). Using June as the cutoff
 * means "today" (late June 2026) resolves to "69", the just-arrived 2026 intake.
 */
export function currentFirstYearPrefix(now: Date = new Date()): string {
  // Resolve the month/year in Asia/Bangkok (UTC+7, no DST), NOT the server's TZ —
  // the container runs UTC. Shift to Bangkok wall-clock first, then read the UTC
  // fields: otherwise the academic-year rollover fires at June 1 00:00 UTC = 07:00
  // Bangkok, mis-classifying first-years for that ~7h window each June.
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  // getUTCMonth() is 0-indexed: 5 = June. Jan–May (0–4) → previous academic year.
  const academicYearCE = bkk.getUTCMonth() >= 5 ? bkk.getUTCFullYear() : bkk.getUTCFullYear() - 1;
  const be = academicYearCE + 543;
  return String(be % 100).padStart(2, "0");
}

/**
 * Whether a student id belongs to the current first-year intake — its first two
 * digits match currentFirstYearPrefix(). Unknown/short ids are treated as NOT
 * first-year (a first-year-only event excludes them), matching how the audience
 * checks fail closed for ids they can't classify.
 */
export function isFirstYearStudent(
  studentId: string | null | undefined,
  now: Date = new Date()
): boolean {
  const cleanId = (studentId || "").trim();
  if (cleanId.length < 2) return false;
  return cleanId.slice(0, 2) === currentFirstYearPrefix(now);
}

/**
 * Year of study (1 = first year) derived from a student id's first two digits
 * vs the current academic-year prefix. Follows the same June/Bangkok rollover as
 * currentFirstYearPrefix. Returns null for ids we can't classify (too short or
 * the result is outside the plausible 1–8 range).
 */
export function yearOfStudy(
  studentId: string | null | undefined,
  now: Date = new Date()
): number | null {
  const cleanId = (studentId || "").trim();
  if (!/^\d{2}/.test(cleanId)) return null;
  const entry = parseInt(cleanId.slice(0, 2), 10);
  const current = parseInt(currentFirstYearPrefix(now), 10);
  const diff = ((current - entry + 100) % 100) + 1;
  if (diff < 1 || diff > 8) return null;
  return diff;
}

/**
 * Thai vs international is derived from the first of the LAST THREE digits
 * of the student id being "5" — this is nationality, not curriculum track.
 * Digit 6 (the id's 6th character) separately marks curriculum TRACK
 * (regular vs special international program) but does NOT determine
 * nationality: a Thai student enrolled in an international-curriculum
 * program still has "0" here, while an actual international student also
 * has "5" here. Verified against two real ids: 682115036 (Thai, enrolled in
 * an international-curriculum program) vs 682115513 (an actual
 * international student, same curriculum track) — both have digit 6 "5",
 * but only the latter has this digit "5" too. Unknown/short ids default to
 * Thai (matches the historic /api/events behaviour).
 */
export function deriveThaiIntl(studentId: string | null | undefined): {
  isThai: boolean;
  isIntl: boolean;
} {
  const cleanId = (studentId || "").trim();
  let isThai = true;
  let isIntl = false;
  if (cleanId.length >= 3) {
    const lastThreeDigitFirst = cleanId.slice(-3)[0];
    if (lastThreeDigitFirst === "5") {
      isThai = false;
      isIntl = true;
    }
  }
  return { isThai, isIntl };
}

/** Build a Viewer from a user's roles, student id, major, and club memberships. */
export function buildViewer(opts: {
  roles: string[] | null | undefined;
  studentId: string | null | undefined;
  major: string | null | undefined;
  /** Club UUIDs the user belongs to (any club_members role) — see ClubsService.getMemberClubIds. */
  clubIds?: string[] | null;
}): Viewer {
  const userRoles = opts.roles && opts.roles.length ? opts.roles : ["student"];
  const isAdminRole = userRoles.some((r) => ADMIN_ROLES.includes(r));
  // Normalize staff aliases (professor, officer → staff) to match allowedRoles.
  const effectiveRoles = userRoles.map((r) =>
    ["professor", "officer"].includes(r) ? "staff" : r
  );
  const { isThai, isIntl } = deriveThaiIntl(opts.studentId);
  const isFirstYear = isFirstYearStudent(opts.studentId);
  return {
    isAdminRole,
    effectiveRoles,
    userMajor: opts.major ?? null,
    isThai,
    isIntl,
    isFirstYear,
    clubIds: opts.clubIds ?? [],
  };
}

/** Whether an authenticated viewer is eligible to see an item. */
export function isEligibleFor(item: EligibilityItem, viewer: Viewer): boolean {
  const targetThai = item.targetThai ?? true;
  const targetInternational = item.targetInternational ?? true;

  // If both targets are unchecked, anyone can join (default to both true).
  const effectiveThai = !targetThai && !targetInternational ? true : targetThai;
  const effectiveIntl = !targetThai && !targetInternational ? true : targetInternational;

  if (viewer.isThai && !effectiveThai) return false;
  if (viewer.isIntl && !effectiveIntl) return false;

  // Role-based access control. Admin roles always bypass.
  if (!viewer.isAdminRole && item.allowedRoles && item.allowedRoles.length > 0) {
    const hasMatchingRole = viewer.effectiveRoles.some((r) =>
      item.allowedRoles!.includes(r)
    );
    if (!hasMatchingRole) return false;
  }

  // Major-based access control. Admin roles always bypass.
  if (!viewer.isAdminRole && item.allowedMajors && item.allowedMajors.length > 0) {
    if (!viewer.userMajor || !item.allowedMajors.includes(viewer.userMajor)) {
      return false;
    }
  }

  // Club-based access control. Admin roles always bypass. A viewer belonging to
  // ANY of the listed clubs (member or president — see getMemberClubIds) qualifies.
  if (!viewer.isAdminRole && item.allowedClubs && item.allowedClubs.length > 0) {
    const inAllowedClub = viewer.clubIds.some((id) => item.allowedClubs!.includes(id));
    if (!inAllowedClub) return false;
  }

  // First-year-only restriction. Admin roles always bypass; everyone whose id
  // isn't in the current first-year intake is excluded.
  if (!viewer.isAdminRole && item.firstYearOnly && !viewer.isFirstYear) {
    return false;
  }

  return true;
}

/**
 * Whether an unauthenticated guest may see an item. A guest has no major (so any
 * major restriction excludes them) and is only shown role-restricted items that
 * explicitly include "student".
 */
export function isEligibleForGuest(item: EligibilityItem): boolean {
  // A guest has no student id, so it can never be a first-year intake member.
  if (item.firstYearOnly) return false;
  if (item.allowedMajors && item.allowedMajors.length > 0) return false;
  // A guest belongs to no club, so any club restriction excludes them.
  if (item.allowedClubs && item.allowedClubs.length > 0) return false;
  if (item.allowedRoles && item.allowedRoles.length > 0) {
    return item.allowedRoles.includes("student");
  }
  return true;
}
