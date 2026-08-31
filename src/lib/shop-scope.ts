import type { Session } from "next-auth";
import { db } from "@/db";
import { shopOrderItems, shopProducts } from "@/db/schema";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { effectiveRoles } from "@/lib/admin-access";
import { isProductOwnedByScope, isShopAdmin, isShopManager, type ShopScope } from "@/lib/shop-auth";
import { eq, inArray } from "drizzle-orm";

// Server-side resolution of a shop-admin caller's access: either full/unscoped
// (super_admin/admin) or scoped to the club(s)/major they preside over
// (club_president/major_president). Every /api/admin/shop route calls this right
// after auth(). Mirrors EventScopeService.resolveEventAccess for events.
export type ShopAccess =
  | { ok: false }
  | { ok: true; unscoped: true; userId: string }
  | { ok: true; unscoped: false; userId: string; scope: ShopScope };

export async function resolveShopAccess(session: Session | null): Promise<ShopAccess> {
  if (!isShopManager(session)) return { ok: false };
  const userId = session!.user!.id!;
  if (isShopAdmin(session)) return { ok: true, unscoped: true, userId };
  const roles = effectiveRoles(session!.user!.role, session!.user!.roles);
  const scope = await EventScopeService.getPresidentScope(userId, roles);
  return { ok: true, unscoped: false, userId, scope };
}

// Per-order ownership classification for a scoped (president) caller. For each of
// the given order ids: which of its line items belong to a product this scope
// owns, whether ANY do (→ the order shows in their queue), and whether ALL
// product-bearing items do (→ they may view the slip + approve/reject).
// A line item whose product was deleted (productId = NULL) can't be attributed
// to any owner, so it counts against "fully owned".
export type OrderScopeInfo = {
  anyOwned: boolean;
  fullyOwned: boolean;
  ownedProductIds: Set<string>;
};

export async function classifyOrdersByScope(
  orderIds: string[],
  scope: ShopScope,
): Promise<Map<string, OrderScopeInfo>> {
  const result = new Map<string, OrderScopeInfo>();
  if (orderIds.length === 0) return result;

  const rows = await db
    .select({
      orderId: shopOrderItems.orderId,
      productId: shopOrderItems.productId,
      ownerClubIds: shopProducts.ownerClubIds,
      ownerMajors: shopProducts.ownerMajors,
    })
    .from(shopOrderItems)
    .leftJoin(shopProducts, eq(shopProducts.id, shopOrderItems.productId))
    .where(inArray(shopOrderItems.orderId, orderIds));

  for (const oid of orderIds) {
    result.set(oid, { anyOwned: false, fullyOwned: true, ownedProductIds: new Set() });
  }
  for (const row of rows) {
    const info = result.get(row.orderId)!;
    const owned =
      row.productId != null &&
      isProductOwnedByScope({ ownerClubIds: row.ownerClubIds, ownerMajors: row.ownerMajors }, scope);
    if (owned) {
      info.anyOwned = true;
      info.ownedProductIds.add(row.productId!);
    } else {
      info.fullyOwned = false;
    }
  }
  return result;
}
