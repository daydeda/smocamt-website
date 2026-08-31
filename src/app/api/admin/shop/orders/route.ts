import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, users } from "@/db/schema";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop-scope";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/shop/orders — the admin review queue: every order with buyer
// info + line items, newest first. The slip is fetched separately (auth-gated)
// via /api/shop/orders/[id]/slip.
// super_admin/admin see every order. A scoped president sees only orders that
// contain at least one line item for a product their club/major owns; line items
// for other clubs' products are stripped from the response, and `fullyInScope`
// tells the client whether the president may review (approve/reject) the order
// (they may only when EVERY line item is theirs — enforced in the PATCH route).
export async function GET(req: Request) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allOrders = await db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        totalAmount: shopOrders.totalAmount,
        note: shopOrders.note,
        rejectionReason: shopOrders.rejectionReason,
        slipPath: shopOrders.slipPath,
        slipFlag: shopOrders.slipFlag,
        slipQrPayload: shopOrders.slipQrPayload,
        createdAt: shopOrders.createdAt,
        reviewedAt: shopOrders.reviewedAt,
        fulfillment: shopOrders.fulfillment,
        shippingFee: shopOrders.shippingFee,
        recipientName: shopOrders.recipientName,
        recipientPhone: shopOrders.recipientPhone,
        shippingAddress: shopOrders.shippingAddress,
        buyerName: users.name,
        buyerStudentId: users.studentId,
        buyerNickname: users.nickname,
      })
      .from(shopOrders)
      .leftJoin(users, eq(shopOrders.buyerId, users.id))
      .orderBy(desc(shopOrders.createdAt));

    // For a scoped president, keep only orders with a line item they own.
    const scopeInfo = access.unscoped
      ? null
      : await classifyOrdersByScope(allOrders.map((o) => o.id), access.scope);
    const orders = scopeInfo ? allOrders.filter((o) => scopeInfo.get(o.id)?.anyOwned) : allOrders;

    // Bulk PII read — the review queue exposes every buyer/recipient name, phone
    // and shipping address it returns. Keep a tamper-evident record of who loaded
    // it (PDPA), mirroring the attendance-list / export access logs.
    await AuditService.logAction({
      actorId: access.userId,
      action: `Viewed shop order review queue (${orders.length} orders${access.unscoped ? "" : ", scoped to owned products"}, included buyer/recipient contact + shipping address)`,
      ipAddress: getClientIp(req),
    });

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await db.select().from(shopOrderItems).where(inArray(shopOrderItems.orderId, orderIds))
      : [];

    const result = orders.map((o) => {
      const info = scopeInfo?.get(o.id);
      return {
        id: o.id,
        status: o.status,
        totalAmount: o.totalAmount,
        note: o.note,
        rejectionReason: o.rejectionReason,
        hasSlip: Boolean(o.slipPath),
        slipFlag: o.slipFlag,
        slipQrPayload: o.slipQrPayload,
        createdAt: o.createdAt,
        reviewedAt: o.reviewedAt,
        fulfillment: o.fulfillment,
        shippingFee: o.shippingFee,
        recipientName: o.recipientName,
        recipientPhone: o.recipientPhone,
        shippingAddress: o.shippingAddress,
        // A scoped president may only review an order that is entirely theirs.
        fullyInScope: info ? info.fullyOwned : true,
        buyer: { name: o.buyerName, studentId: o.buyerStudentId, nickname: o.buyerNickname },
        items: items
          .filter((i) => i.orderId === o.id)
          // Strip line items for products outside a president's scope.
          .filter((i) => !info || (i.productId != null && info.ownedProductIds.has(i.productId)))
          .map((i) => ({ productName: i.productName, variantLabel: i.variantLabel, customValues: i.customValues ?? null, unitPrice: i.unitPrice, quantity: i.quantity })),
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
