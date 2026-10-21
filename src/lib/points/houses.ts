// Canonical house slugs used in URLs ↔ the database house id (a colour).
//
// The houses table primary key is unchanged (red/green/yellow/blue) and so are all
// the foreign keys that reference it (users.house_id, score_history.house_id, …).
// These slugs are purely a presentation alias so member-page URLs read
// /dashboard/houses/mom instead of /dashboard/houses/red. Nothing is migrated.
export const HOUSE_SLUG_BY_ID: Record<string, string> = {
  red: "mom",
  green: "to",
  yellow: "luang",
  blue: "makon",
};

export const HOUSE_ID_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(HOUSE_SLUG_BY_ID).map(([id, slug]) => [slug, id])
);

/** URL slug for a house id (e.g. "red" → "mom"); falls back to the input if unmapped. */
export const houseSlug = (id?: string | null): string =>
  id ? HOUSE_SLUG_BY_ID[id.toLowerCase()] ?? id : "";

/**
 * Resolve a URL param to the database house id. Accepts either a slug ("mom") or a
 * raw id ("red") so old colour-based links keep working.
 */
export const houseIdFromParam = (param: string): string =>
  HOUSE_ID_BY_SLUG[param.toLowerCase()] ?? param.toLowerCase();
