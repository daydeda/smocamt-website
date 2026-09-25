import type { Session } from "next-auth";
import { effectiveRoles, isShopFinancePosition } from "@/lib/admin-access";

// Who may manage the shop UNSCOPED (create central products, set the QR, edit
// global shop settings, review sellers/products, see every order): super_admin,
// admin, or the canonical SMO Finance position. Checks the full roles array
// since a user can hold several roles.
export function isShopAdmin(session: Session | null): boolean {
  if (!session?.user) return false;
  const roles = effectiveRoles(session.user.role, session.user.roles);
  return roles.some((r) => r === "super_admin" || r === "admin") ||
    isShopFinancePosition(roles, session.user.smoPosition);
}

// The unscoped shop OWNERS: super_admin/admin only. SMO Finance is an unscoped
// reviewer (isShopAdmin) but not an owner — it may not delete products, and a
// central product it creates starts pending until one of these approves it.
export function isShopFullAdmin(session: Session | null): boolean {
  if (!session?.user) return false;
  const roles = effectiveRoles(session.user.role, session.user.roles);
  return roles.some((r) => r === "super_admin" || r === "admin");
}

// Roles that get a SCOPED shop: presidents keep their club/major ownership axis,
// while an approved shop_seller is additionally bound to its direct seller id.
// resolveShopAccess performs the DB-backed approval check before returning data.
const SHOP_SCOPED_ROLES = ["club_president", "major_president", "shop_seller"] as const;

// Who may enter the shop admin area at all — unscoped admins plus the scoped
// president roles. The page gate + every /api/admin/shop route uses this, then
// branches on isShopAdmin for the unscoped-vs-scoped split.
export function isShopManager(session: Session | null): boolean {
  if (!session?.user) return false;
  if (isShopAdmin(session)) return true;
  const roles = effectiveRoles(session.user.role, session.user.roles);
  return roles.some((r) => (SHOP_SCOPED_ROLES as readonly string[]).includes(r));
}

// A president's resolved ownership scope (from EventScopeService.getPresidentScope).
export type ShopScope = { clubIds: string[]; majors: string[] };

type OwnedProduct = {
  ownerClubIds?: string[] | null;
  ownerMajors?: string[] | null;
  sellerId?: string | null;
};

// Does this scope own the product? Requires a NON-EMPTY intersection on either
// axis — a product with no owner assigned (central) is owned by no president and
// stays admin-only. Mirrors EventScopeService.isEventManagedByScope.
export function isProductOwnedByScope(
  product: OwnedProduct,
  scope: ShopScope,
  sellerId?: string | null,
): boolean {
  if (sellerId && product.sellerId === sellerId) return true;
  // Once a product belongs to another concrete seller, shared club/major
  // ownership must not let a different president edit that seller's payout item.
  if (product.sellerId) return false;
  const clubMatch = (product.ownerClubIds ?? []).some((id) => scope.clubIds.includes(id));
  const majorMatch = (product.ownerMajors ?? []).some((m) => scope.majors.includes(m));
  return clubMatch || majorMatch;
}

// List-filter variant of isProductOwnedByScope.
export function filterProductsByScope<T extends OwnedProduct>(
  products: T[],
  scope: ShopScope,
  sellerId?: string | null,
): T[] {
  return products.filter((p) => isProductOwnedByScope(p, scope, sellerId));
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
