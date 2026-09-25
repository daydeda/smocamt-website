import type { Session } from "next-auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, shopSellers } from "@/db/schema";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { effectiveRoles } from "@/lib/admin-access";
import { isProductOwnedByScope, isShopAdmin, isShopFullAdmin, isShopManager, type ShopScope } from "@/lib/shop-auth";
import { eq, inArray } from "drizzle-orm";

// Server-side resolution of a shop-admin caller's access: either full/unscoped
// (super_admin/admin, or SMO Finance with fullAdmin=false — sees and reviews
// everything but may not delete, and its new products need approval) or scoped to the club(s)/major they preside over
// (club_president/major_president). Every /api/admin/shop route calls this right
// after auth(). Mirrors EventScopeService.resolveEventAccess for events.
export type ShopAccess =
  | { ok: false }
  | { ok: true; unscoped: true; fullAdmin: boolean; userId: string }
  | {
      ok: true;
      unscoped: false;
      userId: string;
      scope: ShopScope;
      seller: { id: string; status: string; displayName: string } | null;
      sellerId: string | null;
    };

export async function resolveShopAccess(session: Session | null): Promise<ShopAccess> {
  if (!isShopManager(session)) return { ok: false };
  const userId = session!.user!.id!;
  if (isShopAdmin(session)) return { ok: true, unscoped: true, fullAdmin: isShopFullAdmin(session), userId };
  const roles = effectiveRoles(session!.user!.role, session!.user!.roles);
  const isPresident = roles.some((role) => role === "club_president" || role === "major_president");

  let [seller] = await db
    .select({ id: shopSellers.id, status: shopSellers.status, displayName: shopSellers.displayName })
    .from(shopSellers)
    .where(eq(shopSellers.userId, userId))
    .limit(1);

  // A club/major president is already vetted through their club_members/major
  // assignment (an admin action), so the generic "apply and wait for review"
  // trust gate a walk-in Google account goes through doesn't apply to them —
  // auto-provision (or promote a pending row left over from before this
  // existed) an approved seller identity so they can manage products and
  // their own payout/fulfilment settings immediately. An explicit
  // rejection/suspension on their row is still an admin override and is left
  // untouched here.
  if (isPresident && !seller) {
    const [inserted] = await db
      .insert(shopSellers)
      .values({
        userId,
        displayName: session!.user!.name?.trim() || "President store",
        status: "approved",
        reviewedAt: new Date(),
      })
      .onConflictDoNothing({ target: shopSellers.userId })
      .returning({ id: shopSellers.id, status: shopSellers.status, displayName: shopSellers.displayName });
    [seller] = inserted
      ? [inserted]
      : await db
          .select({ id: shopSellers.id, status: shopSellers.status, displayName: shopSellers.displayName })
          .from(shopSellers)
          .where(eq(shopSellers.userId, userId))
          .limit(1);
  } else if (isPresident && seller && seller.status === "pending") {
    await db.update(shopSellers).set({ status: "approved", reviewedAt: new Date() }).where(eq(shopSellers.id, seller.id));
    seller = { ...seller, status: "approved" };
  }

  const approvedSeller = seller?.status === "approved" ? seller : null;
  // `shop_seller` is an additive DB-backed capability. A stale JWT role never
  // grants access after rejection/suspension; the approved seller row is required.
  if (!isPresident && !approvedSeller) return { ok: false };
  const scope = await EventScopeService.getPresidentScope(userId, roles);
  return {
    ok: true,
    unscoped: false,
    userId,
    scope,
    seller: seller ?? null,
    sellerId: approvedSeller?.id ?? null,
  };
}

// Per-order ownership classification for a scoped (president) caller. For each of
// the given order ids: which of its line items belong to a product this scope
// owns, whether ANY do (→ the order shows in their queue), and whether ALL
// product-bearing items do (→ they may view the slip + approve/reject).
// A legacy line whose product was deleted (productId = NULL) can't be attributed
// to a club/major owner, so it counts against "fully owned". A marketplace order
// remains attributable through shop_orders.sellerId and keeps its item snapshots.
export type OrderScopeInfo = {
  anyOwned: boolean;
  fullyOwned: boolean;
  directSellerOrder: boolean;
  ownedProductIds: Set<string>;
};

export async function classifyOrdersByScope(
  orderIds: string[],
  scope: ShopScope,
  sellerId?: string | null,
): Promise<Map<string, OrderScopeInfo>> {
  const result = new Map<string, OrderScopeInfo>();
  if (orderIds.length === 0) return result;

  const rows = await db
    .select({
      orderId: shopOrderItems.orderId,
      orderSellerId: shopOrders.sellerId,
      productId: shopOrderItems.productId,
      productSellerId: shopProducts.sellerId,
      ownerClubIds: shopProducts.ownerClubIds,
      ownerMajors: shopProducts.ownerMajors,
    })
    .from(shopOrderItems)
    .innerJoin(shopOrders, eq(shopOrders.id, shopOrderItems.orderId))
    .leftJoin(shopProducts, eq(shopProducts.id, shopOrderItems.productId))
    .where(inArray(shopOrderItems.orderId, orderIds));

  for (const oid of orderIds) {
    result.set(oid, { anyOwned: false, fullyOwned: true, directSellerOrder: false, ownedProductIds: new Set() });
  }
  for (const row of rows) {
    const info = result.get(row.orderId)!;
    const directSellerOrder = !!sellerId && row.orderSellerId === sellerId;
    const owned = directSellerOrder || (
      row.productId != null &&
      isProductOwnedByScope(
        {
          sellerId: row.productSellerId,
          ownerClubIds: row.ownerClubIds,
          ownerMajors: row.ownerMajors,
        },
        scope,
        sellerId,
      )
    );
    if (owned) {
      info.anyOwned = true;
      if (directSellerOrder) info.directSellerOrder = true;
      if (row.productId) info.ownedProductIds.add(row.productId);
    } else {
      info.fullyOwned = false;
    }
  }
  return result;
}
