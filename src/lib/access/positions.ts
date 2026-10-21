// Canonical SMO/club/major "position" (title) enum — DISTINCT from users.role/
// roles (system access-control). Stored as a stable id — club_members.position
// (per club), users.majorPosition, users.smoPosition, users.anusmoPosition (each
// scoped independently, never the raw Thai string), so relabeling a title later
// needs no data migration.

export const POSITION_IDS = [
  "president",
  "vice_president",
  "secretary",
  "finance",
  "registration",
  "coordination",
  "pr",
  "creative_production",
  "project",
  "venue",
  "welfare",
  "medical",
  "club_affairs",
] as const;

export type PositionId = (typeof POSITION_IDS)[number];

export const POSITION_I18N_KEY: Record<PositionId, string> = {
  president: "positionPresident",
  vice_president: "positionVicePresident",
  secretary: "positionSecretary",
  finance: "positionFinance",
  registration: "positionRegistration",
  coordination: "positionCoordination",
  pr: "positionPR",
  creative_production: "positionCreativeProduction",
  project: "positionProject",
  venue: "positionVenue",
  welfare: "positionWelfare",
  medical: "positionMedical",
  club_affairs: "positionClubAffairs",
};

// Plain-English labels for server-side output (xlsx exports, audit log text)
// that has no access to the client-side LanguageContext `t` object. Mirrors
// the "en" entries of POSITION_I18N_KEY in src/lib/i18n.ts.
export const POSITION_LABEL_EN: Record<PositionId, string> = {
  president: "President",
  vice_president: "Vice President",
  secretary: "Secretary",
  finance: "Finance",
  registration: "Registration",
  coordination: "Coordination",
  pr: "PR",
  creative_production: "Creative Production",
  project: "Project",
  venue: "Venue",
  welfare: "Welfare",
  medical: "Medical",
  club_affairs: "Club Affairs",
};

// club_affairs (ฝ่ายชมรม) is only assignable/visible when the TARGET user
// holds smo or anusmo in their effective role set.
export function isClubAffairsEligible(targetRoles: string[]): boolean {
  return targetRoles.includes("smo") || targetRoles.includes("anusmo");
}

// Used verbatim (never club_affairs) by the club-president and major-president
// member-management surfaces — those rosters are never smo/anusmo by
// construction, so no per-target role check is needed there.
export const NON_SMO_POSITION_IDS = POSITION_IDS.filter((id) => id !== "club_affairs");
