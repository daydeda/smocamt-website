import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, users } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
import { resolveShopAccess, classifyOrdersByScope, type OrderScopeInfo } from "@/lib/shop-scope";
import { isProductOwnedByScope } from "@/lib/shop-auth";
import { isItemHandedOver } from "@/lib/shop-fulfillment";
import { HandoverRefused, handOverItems, undoItemHandover } from "@/lib/shop-fulfillment-server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { captureException } from "@/lib/logger";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
// Match the scanner/prize booth budget: the counter must stay responsive.
export const maxDuration = 20;

// POST /api/admin/shop/fulfillment/scan — the pickup counter (and on-campus
// delivery at the door). Staff choose the PRODUCT first, then scan, so only
// that product's lines can be handed over — a buyer with several orders, or
// two products sharing a name, can't be given the wrong thing by a stray tick.
//   "preview": resolve the scanned Digital ID and list that buyer's lines of the
//              chosen product — writes nothing, so staff see "already received
//              on …" BEFORE handing anything over.
//   "confirm": hand over the chosen lines. The QR is re-verified (tokens live
//              ~5 min) and every line is re-checked under a row lock: it must
//              belong to THIS buyer, be the chosen product, be in the caller's
//              scope, and not be handed over yet.
//   "undo":    take back lines just handed over (a slip at the counter).
const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), qrToken: z.string().min(1).max(2000), productId: uuid }),
  z.object({
    action: z.literal("confirm"),
    qrToken: z.string().min(1).max(2000),
    productId: uuid,
    itemIds: z.array(uuid).min(1).max(50),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("undo"), itemIds: z.array(uuid).min(1).max(50) }),
]);

const fulfillers = alias(users, "fulfillers");
const lineHanders = alias(users, "line_handers");

type Line = {
  itemId: string;
  orderId: string;
  productName: string;
  variantLabel: string;
  customValues: { label: string; value: string }[] | null;
  quantity: number;
  fulfillment: string;
  orderCreatedAt: Date | null;
};

export async function POST(req: Request) {
  const ip = getClientIp(req);
  // One handover is 2 requests (preview + confirm); clear a fast queue.
  const limiter = await rateLimit(ip, 300, 60000);
  if (!limiter.success) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, {
      status: 429,
      headers: { "Retry-After": Math.ceil((limiter.resetTime - Date.now()) / 1000).toString() },
    });
  }

  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = schema.parse(await req.json());

    // A scoped seller/president may only hand over lines on orders that are
    // entirely theirs (same rule as payment review).
    const assertLinesInScope = async (itemIds: string[]) => {
      if (access.unscoped) return;
      const owners = await db.select({ orderId: shopOrderItems.orderId }).from(shopOrderItems).where(inArray(shopOrderItems.id, itemIds));
      const orderIds = [...new Set(owners.map((o) => o.orderId))];
      const info = await classifyOrdersByScope(orderIds, access.scope, access.sellerId);
      if (orderIds.some((oid) => !info.get(oid)?.anyOwned || !info.get(oid)?.fullyOwned)) {
        throw new HandoverRefused("One of these items isn't yours to hand over.", 403);
      }
    };

    if (body.action === "undo") {
      await assertLinesInScope(body.itemIds);
      const changes = await db.transaction((tx) => undoItemHandover(tx, { itemIds: body.itemIds, actorId: access.userId, ip }));
      return NextResponse.json({ success: true, changes });
    }

    // The product the counter chose must be one this caller manages.
    const [product] = await db
      .select({
        id: shopProducts.id,
        name: shopProducts.name,
        sellerId: shopProducts.sellerId,
        ownerClubIds: shopProducts.ownerClubIds,
        ownerMajors: shopProducts.ownerMajors,
      })
      .from(shopProducts)
      .where(eq(shopProducts.id, body.productId))
      .limit(1);
    if (!product || (!access.unscoped && !isProductOwnedByScope(product, access.scope, access.sellerId))) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }

    const student = await UsersService.resolveStudentByToken(body.qrToken, ip);
    if (!student) {
      return NextResponse.json(
        { error: "QR not recognised or expired. Ask the buyer to refresh their Digital ID and scan again." },
        { status: 404 }
      );
    }
    const buyer = { id: student.id, name: student.name, nickname: student.nickname, studentId: student.studentId };

    if (body.action === "confirm") {
      await assertLinesInScope(body.itemIds);
      const changes = await db.transaction((tx) => handOverItems(tx, {
        itemIds: body.itemIds,
        actorId: access.userId,
        via: "qr",
        note: body.note,
        ip,
        buyerId: buyer.id,
        productId: product.id,
      }));
      return NextResponse.json({ success: true, buyer, changes });
    }

    // preview: every paid-or-pending order of this buyer, filtered to the
    // caller's scope, then its lines sorted into what the counter should do.
    const orders = await db
      .select({
        id: shopOrders.id,
        status: shopOrders.status,
        fulfillment: shopOrders.fulfillment,
        fulfillmentStatus: shopOrders.fulfillmentStatus,
        createdAt: shopOrders.createdAt,
        fulfilledAt: shopOrders.fulfilledAt,
        fulfilledByName: fulfillers.name,
      })
      .from(shopOrders)
      .leftJoin(fulfillers, eq(shopOrders.fulfilledBy, fulfillers.id))
      .where(and(eq(shopOrders.buyerId, buyer.id), inArray(shopOrders.status, ["pending", "approved"])))
      .orderBy(desc(shopOrders.createdAt));

    let scopeInfo: Map<string, OrderScopeInfo> | null = null;
    if (!access.unscoped) scopeInfo = await classifyOrdersByScope(orders.map((o) => o.id), access.scope, access.sellerId);
    const visible = scopeInfo ? orders.filter((o) => scopeInfo!.get(o.id)?.fullyOwned && scopeInfo!.get(o.id)?.anyOwned) : orders;
    const orderById = new Map(visible.map((o) => [o.id, o]));

    const items = visible.length
      ? await db
          .select({
            id: shopOrderItems.id,
            orderId: shopOrderItems.orderId,
            productId: shopOrderItems.productId,
            productName: shopOrderItems.productName,
            variantLabel: shopOrderItems.variantLabel,
            customValues: shopOrderItems.customValues,
            quantity: shopOrderItems.quantity,
            handedOverAt: shopOrderItems.handedOverAt,
            handedOverByName: lineHanders.name,
          })
          .from(shopOrderItems)
          .leftJoin(lineHanders, eq(shopOrderItems.handedOverBy, lineHanders.id))
          .where(inArray(shopOrderItems.orderId, visible.map((o) => o.id)))
      : [];

    const toLine = (i: (typeof items)[number]): Line => {
      const o = orderById.get(i.orderId)!;
      return {
        itemId: i.id,
        orderId: i.orderId,
        productName: i.productName,
        variantLabel: i.variantLabel,
        customValues: i.customValues ?? null,
        quantity: i.quantity,
        fulfillment: o.fulfillment,
        orderCreatedAt: o.createdAt,
      };
    };
    const inPerson = (s: string) => s === "awaiting" || s === "ready" || s === "partial";

    const toHand: Line[] = [];
    const mailed: Line[] = [];
    const unpaid: Line[] = [];
    const done: (Line & { handedAt: Date | null; handedByName: string | null })[] = [];
    const otherWaiting: Line[] = [];
    for (const i of items) {
      const o = orderById.get(i.orderId)!;
      const handed = isItemHandedOver(i, o.fulfillmentStatus);
      if (i.productId !== product.id) {
        if (o.status === "approved" && !handed && inPerson(o.fulfillmentStatus)) otherWaiting.push(toLine(i));
        continue;
      }
      if (o.status === "pending") unpaid.push(toLine(i));
      else if (handed) done.push({ ...toLine(i), handedAt: i.handedOverAt ?? o.fulfilledAt, handedByName: i.handedOverByName ?? o.fulfilledByName });
      else if (inPerson(o.fulfillmentStatus)) toHand.push(toLine(i));
      else mailed.push(toLine(i));
    }

    await AuditService.logAction({
      actorId: access.userId,
      targetId: buyer.id,
      action: `Scanned Digital ID at shop handover for product ${product.id} (${toHand.length} line(s) to hand over)`,
      ipAddress: ip,
    });

    return NextResponse.json({
      buyer,
      product: { id: product.id, name: product.name },
      // Paid, in person, not yet handed over → can be handed over now.
      toHand,
      // Already in the buyer's hands → the "already received" warning.
      done: done.sort((a, b) => (b.handedAt?.getTime() ?? 0) - (a.handedAt?.getTime() ?? 0)).slice(0, 10),
      // Not paid yet → do NOT hand over; shown so staff can say why.
      unpaid,
      // Being sent by mail → don't hand over at the counter.
      mailed,
      // Other products this buyer is still waiting for (context only).
      otherWaiting,
    });
  } catch (error) {
    if (error instanceof HandoverRefused) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    captureException(error, { route: "POST /api/admin/shop/fulfillment/scan" });
    return NextResponse.json({ error: "Failed to record the handover" }, { status: 500 });
  }
}
