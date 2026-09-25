import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopSellers } from "@/db/schema";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop-scope";
import { summarizeByProduct } from "@/lib/shop-finance";
import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/shop/finance — money per product, split by order status
// (approved = confirmed income, pending = awaiting slip review, rejected).
// Aggregates only (no buyer/recipient data), so no PDPA access log is needed.
// super_admin/admin and SMO Finance see every product; a scoped president or
// seller sees only the lines they own — the same rule as the orders queue.
export async function GET() {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orders = await db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        discountAmount: shopOrders.discountAmount,
        shippingFee: shopOrders.shippingFee,
        sellerName: shopSellers.displayName,
      })
      .from(shopOrders)
      .leftJoin(shopSellers, eq(shopOrders.sellerId, shopSellers.id));

    const scopeInfo = access.unscoped
      ? null
      : await classifyOrdersByScope(orders.map((o) => o.id), access.scope, access.sellerId);
    const visible = scopeInfo ? orders.filter((o) => scopeInfo.get(o.id)?.anyOwned) : orders;

    const orderIds = visible.map((o) => o.id);
    const items = orderIds.length
      ? await db
          .select({
            orderId: shopOrderItems.orderId,
            productId: shopOrderItems.productId,
            productName: shopOrderItems.productName,
            unitPrice: shopOrderItems.unitPrice,
            quantity: shopOrderItems.quantity,
          })
          .from(shopOrderItems)
          .where(inArray(shopOrderItems.orderId, orderIds))
      : [];
    const itemsByOrder = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    // Each order keeps its full line list so its discount/shipping split is
    // right; only the lines this caller owns count (mirrors the orders GET).
    const summary = summarizeByProduct(
      visible.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })),
      (line, order) => {
        const info = scopeInfo?.get(order.id);
        return !info || info.directSellerOrder || (line.productId != null && info.ownedProductIds.has(line.productId));
      },
    );
    return NextResponse.json({ ...summary, scoped: !access.unscoped });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

