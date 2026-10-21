// ActiveCAMT is CAMT-only — the multi-faculty (MASSCOM/ARCH/ARTS) model was
// prep work for a separate project (Songsue) that landed here by mistake and
// has been reverted. This module keeps the `faculty`-shaped plumbing (houses.
// faculty, houses.color_group, users.faculty columns) so the DB doesn't need a
// column drop, but only CAMT is a valid faculty now — 4 colour houses, no
// per-faculty split.

export type FacultyId = "CAMT";
export type ColorId = "red" | "green" | "yellow" | "blue";

export interface Faculty {
  id: FacultyId;
  /** Short label for UI; the translated name lives in i18n (facultyCamt/…). */
  name: string;
  /** Faculty-specific major codes. Empty → faculty has no major sub-selection yet. */
  majors: string[];
}

export const FACULTIES: Faculty[] = [
  { id: "CAMT", name: "CAMT", majors: ["ANI", "DG", "DII", "MMIT", "SE"] },
];

export const FACULTY_IDS: FacultyId[] = FACULTIES.map((f) => f.id);
export const DEFAULT_FACULTY: FacultyId = "CAMT";

export const isFacultyId = (v: unknown): v is FacultyId =>
  typeof v === "string" && (FACULTY_IDS as string[]).includes(v);

/** Faculty a user belongs to, defaulting null/unknown to CAMT for back-compat. */
export const normalizeFaculty = (v: unknown): FacultyId =>
  isFacultyId(v) ? v : DEFAULT_FACULTY;

export const majorsForFaculty = (faculty: unknown): string[] =>
  FACULTIES.find((f) => f.id === normalizeFaculty(faculty))?.majors ?? [];

/**
 * CMU official faculty code (student id digits 3-4, per km-core-62213.pdf) for
 * CAMT: 21 = วิทยาลัยศิลปะ สื่อ และเทคโนโลยี. ActiveCAMT is CAMT-only, so this
 * exists purely as typo protection — it flags a student id whose faculty
 * digits don't say CAMT, rather than silently accepting any 9 digits.
 */
export const FACULTY_CODE_TO_ID: Record<string, FacultyId> = {
  "21": "CAMT",
};

/**
 * Derive a FacultyId from digits 3-4 of a student id. Returns null for a
 * too-short id or a code other than CAMT's — callers must NOT default a null
 * result to CAMT (that would silently accept a mistyped/non-CAMT id).
 */
export const facultyFromStudentId = (studentId: string | null | undefined): FacultyId | null => {
  const cleanId = (studentId || "").trim();
  if (cleanId.length < 4) return null;
  return FACULTY_CODE_TO_ID[cleanId.slice(2, 4)] ?? null;
};

// The 4 shared colour houses. `name` mirrors the seed/i18n house names; `color`
// is the display hex (kept in sync with src/db/seed.ts).
export interface HouseColor {
  id: ColorId;
  name: string;
  color: string;
}

export const COLORS: HouseColor[] = [
  { id: "red", name: "Mom", color: "#ef4444" },
  { id: "green", name: "To", color: "#94a3b8" },
  { id: "yellow", name: "Luang", color: "#3b82f6" },
  { id: "blue", name: "Makon", color: "#22c55e" },
];

export const COLOR_IDS: ColorId[] = COLORS.map((c) => c.id);

/** House id for a colour. CAMT keeps the bare colour id ('red'…) so existing
 *  house_id foreign keys (users.house_id, score_history.house_id) never move. */
export const houseRowId = (_faculty: FacultyId, color: ColorId): string => color;

/** The colour group a house id belongs to. Also tolerates leftover
 *  '<faculty>-<colour>' ids (e.g. 'masscom-red') from the reverted multi-faculty
 *  migration, in case any haven't been cleaned up from the DB yet. Returns null
 *  for an unrecognised id. */
export const colorGroupOfHouseId = (houseId: string | null | undefined): ColorId | null => {
  if (!houseId) return null;
  const tail = houseId.includes("-") ? houseId.slice(houseId.lastIndexOf("-") + 1) : houseId;
  return (COLOR_IDS as string[]).includes(tail) ? (tail as ColorId) : null;
};

/** All (faculty, colour) house rows, in a stable order — just the 4 CAMT houses. */
export const ALL_HOUSE_ROWS: { id: string; faculty: FacultyId; color: HouseColor }[] =
  FACULTY_IDS.flatMap((faculty) =>
    COLORS.map((color) => ({ id: houseRowId(faculty, color.id), faculty, color })),
  );

/**
 * Canonical (English, untranslated) house display name, derived from the
 * house's id/colorGroup rather than trusting a stored `houses.name` column.
 * The DB row's `name` is meant to always mirror COLORS (seed.ts force-syncs
 * it on every reseed), but nothing stops it drifting in between reseeds — a
 * stale row silently shows the wrong name everywhere that reads it directly.
 * Callers that don't have (or don't want) full i18n — xlsx exports, admin
 * list cards that are otherwise untranslated — should derive the name from
 * this instead of `house.name` so a DB-level drift can't leak into the UI.
 * Falls back to the stored name only for a house id this module doesn't
 * recognise (defensive, should not happen for a CAMT-only house).
 */
export const canonicalHouseName = (
  house: { id?: string | null; name?: string | null } | null | undefined,
): string => {
  const colorGroup = colorGroupOfHouseId(house?.id);
  const color = colorGroup ? COLORS.find((c) => c.id === colorGroup) : undefined;
  return color?.name ?? house?.name ?? "";
};
