import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, users } from "@/db/schema";
import { isShopAdmin } from "@/lib/shop-auth";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/shop/orders — every order with buyer info + line items, newest
// first, for the admin review queue. The slip is fetched separately (auth-gated)
// via /api/shop/orders/[id]/slip.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!isShopAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orders = await db
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

    // Bulk PII read — the review queue exposes every buyer/recipient name, phone and
    // shipping address. Keep a tamper-evident record of who loaded it (PDPA),
    // mirroring the attendance-list / export access logs.
    await AuditService.logAction({
      actorId: session!.user!.id!,
      action: `Viewed shop order review queue (${orders.length} orders, included buyer/recipient contact + shipping address)`,
      ipAddress: getClientIp(req),
    });

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await db.select().from(shopOrderItems).where(inArray(shopOrderItems.orderId, orderIds))
      : [];

    const result = orders.map((o) => ({
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
      buyer: { name: o.buyerName, studentId: o.buyerStudentId, nickname: o.buyerNickname },
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({ productName: i.productName, variantLabel: i.variantLabel, customValues: i.customValues ?? null, unitPrice: i.unitPrice, quantity: i.quantity })),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
