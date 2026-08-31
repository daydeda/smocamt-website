// Single source of truth for who may enter the admin area and where they land.
// Used by the proxy middleware (src/proxy.ts), the admin layout, and the "Admin
// Panel" entry points (StudentNav, AdminLayoutWrapper) so all four gating layers
// move together. Pure data/predicates only — safe to import in the edge proxy.
// Server-side API/route gates remain the source of truth for data access.

// Roles allowed to open the admin area at all. "smo", "club_president" and
// "major_president" are scanner-only — they can enter, but AdminNav shows just the
// Scanner and the sensitive APIs still reject them.
export const ADMIN_ENTRY_ROLES = ["super_admin", "admin", "registration", "organizer", "smo", "club_president", "major_president"] as const;

// Scanner-only roles: allowed into /admin but confined to the QR scanner.
export const SCANNER_ONLY_ROLES = ["smo", "club_president", "major_president"] as const;

// Roles permitted to award/deduct INDIVIDUAL student points in the scanner.
// "smo" keeps full scanner (check-in + scoring); the president roles are check-in
// only — they can scan attendance but must not give/deduct individual points.
// Enforced server-side in /api/admin/scan and ScannerService; the UI just hides
// the Score toggle for non-scoring roles.
export const SCORING_ROLES = ["super_admin", "admin", "registration", "organizer", "smo"] as const;

// Canonical scanner path — also the landing for scanner-only roles.
export const SCANNER_HREF = "/admin/scanner";

// Pages a scanner-only role (smo, club_president, major_president) may open.
// Besides the scanner they may now reach the events page for a widening set of
// thin, role-specific views — never the full staff controls (see admin/events
// page): attendance roster (thin, no phone/emergency/medical signal — see
// api/admin/events/[id]/attendance), and evaluation forms (see .../[id]/form)
// where club_president/major_president may fully manage forms (create/edit/
// delete) but ONLY for events they own (scoped via EventScopeService, same
// pattern as appeals/strikes below), while smo gets read-only access to every
// event's forms/submissions (no ownership scoping) with no create/edit/delete.
// "/admin" is allowed because its page just redirects to the scanner.
// "/admin/clubs" is allowed too, but only club_president gets real data there —
// the page renders read-only and scoped to just the club(s) they preside over
// (see GET /api/admin/clubs and .../[id]/members); smo/major_president reaching
// this path get an empty/401 response since they preside over nothing.
// "/admin/appeals" is allowed too: smo gets a read-only view (VIEW_APPEALS_ROLES,
// src/lib/strikes.ts) while club_president/major_president may also approve/
// reject appeals for events they own (RESOLVE_APPEALS_ROLES, scoped via
// EventScopeService).
// "/admin/majors" is the major_president analogue of "/admin/clubs" — it
// renders the propose-event section scoped to the president's own users.major
// (see admin/majors/page.tsx); club_president/smo reaching this path get the
// page's own empty state since they have no major to propose for.
// "/admin/shop" is allowed for club_president/major_president — they get a
// SCOPED shop (products their club/major owns via shop_products.ownerClubIds/
// ownerMajors, and only orders for those products; see src/lib/shop-auth.ts
// isShopManager + the /api/admin/shop routes). The page's own isShopManager
// gate bounces smo (scanner-only, no ownership) back out.
export const SCANNER_ONLY_PAGES = ["/admin", SCANNER_HREF, "/admin/events", "/admin/clubs", "/admin/majors", "/admin/appeals", "/admin/shop"] as const;

// May a scanner-only role reach this exact (page) path? Used by the proxy to
// confine these roles. Exact-match only — no /admin/events/* sub-pages exist.
export function isScannerOnlyAllowedPath(pathname: string): boolean {
  return (SCANNER_ONLY_PAGES as readonly string[]).includes(pathname);
}

export function canEnterAdmin(role?: string | null): boolean {
  return (ADMIN_ENTRY_ROLES as readonly string[]).includes(role || "");
}

// Scanner-only roles can enter the admin area but only reach the scanner.
export function isScannerOnlyRole(role?: string | null): boolean {
  return (SCANNER_ONLY_ROLES as readonly string[]).includes(role || "");
}

// May this role award/deduct individual student points? Excludes the president
// roles (check-in only) while keeping smo and the full admin roles.
export function canGiveIndividualScore(role?: string | null): boolean {
  return (SCORING_ROLES as readonly string[]).includes(role || "");
}

// Where an admin-capable user should land. SMO has no dashboard access, so it goes
// straight to the scanner; everyone else lands on the dashboard.
export function adminLandingHref(role?: string | null): string {
  return isScannerOnlyRole(role) ? SCANNER_HREF : "/admin/dashboard";
}

/* ---------------------------------------------------------------------------
 * Multi-role predicates. A user holds a SET of roles (users.roles[]); their
 * singular users.role is just the highest-priority one (see auth.getPrimaryRole).
 * Gating must consider ALL their roles, or a user whose admin-granting role isn't
 * the primary one (e.g. a club/major president whose primary resolves to anusmo)
 * gets locked out of the admin area even though one of their roles allows it.
 * These wrap the single-role predicates so every layer (proxy, entry points,
 * AdminNav, landing) stays consistent with admin/layout.tsx.
 * ------------------------------------------------------------------------- */

// Full-admin roles = admin-entry roles that are NOT scanner-only. Holding any of
// these means a real admin (dashboard + their allowed sections), not scanner-confined.
const FULL_ADMIN_ROLES = (ADMIN_ENTRY_ROLES as readonly string[]).filter(
  (r) => !(SCANNER_ONLY_ROLES as readonly string[]).includes(r)
);

// Resolve a user's effective role set: roles[] when populated, else the singular
// role, else "student". (An empty roles[] is truthy, so `roles || [role]` would
// wrongly yield [] and lock the user out — mirror auth.getPrimaryRole's guard.)
export function effectiveRoles(role?: string | null, roles?: string[] | null): string[] {
  if (roles && roles.length > 0) return roles;
  return role ? [role] : ["student"];
}

/* ---------------------------------------------------------------------------
 * Scoped positions (src/lib/positions.ts titles), replacing the old single
 * global users.position column: club_members.position (per club),
 * users.majorPosition, users.smoPosition, users.anusmoPosition. A holder of
 * "registration" as their smoPosition/anusmoPosition grants access whose
 * breadth depends on who holds it. SMO/ANUSMO holders get the full unscoped
 * breadth the "registration" ROLE has today (this predicate); club/major
 * members holding the position instead get an EVENT-scoped subset — see
 * EventScopeService.getRegistrationPositionScope, which is NOT reflected
 * here (a club/major-scoped holder must never pass this global check).
 * smoPosition/anusmoPosition params are all optional so every existing call
 * site keeps its exact current behavior until it's deliberately updated.
 * ------------------------------------------------------------------------- */
export function isGlobalRegistrationPosition(
  roles: string[],
  smoPosition?: string | null,
  anusmoPosition?: string | null,
): boolean {
  return (
    (roles.includes("smo") && smoPosition === "registration") ||
    (roles.includes("anusmo") && anusmoPosition === "registration")
  );
}

// May any of these roles enter the admin area at all? ANY staff position
// (src/lib/positions.ts — vice_president, secretary, finance, ..., not just
// "registration"), in ANY scope (club, major, smo, anusmo), grants at least
// confined entry: a plain club/major member holding a staff title has
// legitimate business inside /admin (e.g. a read-only view of their own
// club's roster, see admin/clubs/page.tsx), even though they hold no
// admin-entry ROLE. isScannerOnlyAny below then confines them the same way
// it already confines a registration-position holder — server-side route
// gates decide exactly what data they can reach. `hasStaffPosition` is a
// precomputed OR across all 4 scoped position fields (see src/auth.ts).
export function canEnterAdminAny(roles: string[], hasStaffPosition?: boolean): boolean {
  return roles.some(canEnterAdmin) || !!hasStaffPosition;
}

// Scanner-only iff the set can enter admin but holds NO full-admin role — i.e.
// every admin-granting role they have is scanner-only. A global registration
// position (smo/anusmo) is full admin, not scanner-only; a club/major-scoped
// registration position falls into the same scanner-only-confined bucket as
// club_president/major_president (SCANNER_ONLY_PAGES already covers it).
export function isScannerOnlyAny(
  roles: string[],
  hasStaffPosition?: boolean,
  smoPosition?: string | null,
  anusmoPosition?: string | null,
): boolean {
  if (isGlobalRegistrationPosition(roles, smoPosition, anusmoPosition)) return false;
  return canEnterAdminAny(roles, hasStaffPosition) && !roles.some((r) => FULL_ADMIN_ROLES.includes(r));
}

// May any of these roles award/deduct individual student points? Deliberately
// role-only/unchanged: a registration-position holder (club/major-scoped or
// not) never gets individual scoring, matching club_president/major_president.
export function canGiveIndividualScoreAny(roles: string[]): boolean {
  return roles.some(canGiveIndividualScore);
}

// Landing href for a role set (scanner-only → scanner, else dashboard).
export function adminLandingHrefForRoles(
  roles: string[],
  hasStaffPosition?: boolean,
  smoPosition?: string | null,
  anusmoPosition?: string | null,
): string {
  return isScannerOnlyAny(roles, hasStaffPosition, smoPosition, anusmoPosition) ? SCANNER_HREF : "/admin/dashboard";
}
