import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, shopSellers } from "@/db/schema";
import { resolveShopAccess } from "@/lib/shop-scope";
import { filterProductsByScope } from "@/lib/shop-auth";
import { captureException } from "@/lib/logger";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/shop/fulfillment/products — the handover counter's product
// picker: every product this caller may hand over, with how much of it is paid
// for and still waiting to be handed over in person. Seller, photo and price
// come along so two products with the same name can be told apart.
export async function GET() {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select({
        id: shopProducts.id,
        name: shopProducts.name,
        price: shopProducts.price,
        imageUrl: shopProducts.imageUrl,
        imageUrls: shopProducts.imageUrls,
        isActive: shopProducts.isActive,
        sellerId: shopProducts.sellerId,
        ownerClubIds: shopProducts.ownerClubIds,
        ownerMajors: shopProducts.ownerMajors,
        sellerName: shopSellers.displayName,
      })
      .from(shopProducts)
      .leftJoin(shopSellers, eq(shopProducts.sellerId, shopSellers.id));
    const products = access.unscoped ? rows : filterProductsByScope(rows, access.scope, access.sellerId);

    const ids = products.map((p) => p.id);
    const waiting = ids.length
      ? await db
          .select({
            productId: shopOrderItems.productId,
            quantity: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)::int`,
            buyers: sql<number>`count(distinct ${shopOrders.buyerId})::int`,
          })
          .from(shopOrderItems)
          .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
          .where(and(
            inArray(shopOrderItems.productId, ids),
            eq(shopOrders.status, "approved"),
            inArray(shopOrders.fulfillmentStatus, ["awaiting", "ready", "partial"]),
            isNull(shopOrderItems.handedOverAt),
          ))
          .groupBy(shopOrderItems.productId)
      : [];
    const waitingById = new Map(waiting.map((w) => [w.productId, w]));

    const result = products
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        imageUrl: p.imageUrls?.[0] ?? p.imageUrl ?? null,
        isActive: p.isActive,
        sellerName: p.sellerName ?? "SMO / CAMT",
        waitingQuantity: waitingById.get(p.id)?.quantity ?? 0,
        waitingBuyers: waitingById.get(p.id)?.buyers ?? 0,
      }))
      .sort((a, b) => b.waitingBuyers - a.waitingBuyers || a.name.localeCompare(b.name));

    return NextResponse.json({ products: result });
  } catch (error) {
    captureException(error, { route: "GET /api/admin/shop/fulfillment/products" });
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}
