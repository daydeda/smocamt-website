import type { Session } from "next-auth";

// Who may manage the shop UNSCOPED (create central products, set the QR, edit
// shop settings, see every order). Mirrors the announcement gate: super_admin +
// admin only — registration/organizer can enter /admin but must not touch
// money/merch. Checks the full roles array since a user can hold several roles.
export function isShopAdmin(session: Session | null): boolean {
  if (!session?.user) return false;
  const roles = session.user.roles ?? (session.user.role ? [session.user.role] : []);
  return roles.some((r) => r === "super_admin" || r === "admin");
}

// Roles that get a SCOPED shop: they manage only products their club/major owns
// (shop_products.ownerClubIds / ownerMajors) and only review orders for those
// products. Resolve the concrete club/major scope with
// EventScopeService.getPresidentScope.
const SHOP_SCOPED_ROLES = ["club_president", "major_president"] as const;

// Who may enter the shop admin area at all — unscoped admins plus the scoped
// president roles. The page gate + every /api/admin/shop route uses this, then
// branches on isShopAdmin for the unscoped-vs-scoped split.
export function isShopManager(session: Session | null): boolean {
  if (!session?.user) return false;
  if (isShopAdmin(session)) return true;
  const roles = session.user.roles ?? (session.user.role ? [session.user.role] : []);
  return roles.some((r) => (SHOP_SCOPED_ROLES as readonly string[]).includes(r));
}

// A president's resolved ownership scope (from EventScopeService.getPresidentScope).
export type ShopScope = { clubIds: string[]; majors: string[] };

type OwnedProduct = { ownerClubIds?: string[] | null; ownerMajors?: string[] | null };

// Does this scope own the product? Requires a NON-EMPTY intersection on either
// axis — a product with no owner assigned (central) is owned by no president and
// stays admin-only. Mirrors EventScopeService.isEventManagedByScope.
export function isProductOwnedByScope(product: OwnedProduct, scope: ShopScope): boolean {
  const clubMatch = (product.ownerClubIds ?? []).some((id) => scope.clubIds.includes(id));
  const majorMatch = (product.ownerMajors ?? []).some((m) => scope.majors.includes(m));
  return clubMatch || majorMatch;
}

// List-filter variant of isProductOwnedByScope.
export function filterProductsByScope<T extends OwnedProduct>(products: T[], scope: ShopScope): T[] {
  return products.filter((p) => isProductOwnedByScope(p, scope));
}

// Would the given owner assignment stay entirely within this scope? Used to stop
// a president creating/editing a product owned by a club/major they don't lead
// (or making it central). An admin bypasses this (they call with unscoped=true
// at the route level and never reach here).
export function isOwnerAssignmentWithinScope(
  ownerClubIds: string[],
  ownerMajors: string[],
  scope: ShopScope,
): boolean {
  const hasOwner = ownerClubIds.length > 0 || ownerMajors.length > 0;
  if (!hasOwner) return false; // a president may never create a central product
  return (
    ownerClubIds.every((id) => scope.clubIds.includes(id)) &&
    ownerMajors.every((m) => scope.majors.includes(m))
  );
}
