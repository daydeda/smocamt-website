import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopSellers, users } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
import { resolveShopAccess, classifyOrdersByScope, type OrderScopeInfo } from "@/lib/shop-scope";
import { isFulfilled, nextFulfillmentStatus } from "@/lib/shop-fulfillment";
import { staffFulfillmentPatch } from "@/lib/shop-fulfillment-server";
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
// delivery at the door). Same two-step shape as the prize booth:
//   "preview": resolve the scanned Digital ID and list that buyer's orders this
//              caller may hand over — writes nothing, so staff see "already
//              picked up on …" BEFORE handing anything over.
//   "confirm": hand over the chosen orders. The QR is re-verified (tokens live
//              ~5 min) and every order is re-checked under a row lock: it must
//              belong to THIS buyer, be in the caller's scope, and still allow
//              a handover.
const schema = z.object({
  action: z.enum(["preview", "confirm"]),
  qrToken: z.string().min(1).max(2000),
  orderIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  note: z.string().trim().max(500).optional(),
});

const fulfillers = alias(users, "fulfillers");

type ScanOrder = {
  id: string;
  fulfillment: string;
  fulfillmentStatus: string;
  status: string;
  totalAmount: number;
  createdAt: Date | null;
  fulfilledAt: Date | null;
  fulfilledByName: string | null;
  sellerName: string | null;
  items: { productName: string; variantLabel: string; customValues: { label: string; value: string }[] | null; quantity: number }[];
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
    const student = await UsersService.resolveStudentByToken(body.qrToken, ip);
    if (!student) {
      return NextResponse.json(
        { error: "QR not recognised or expired — ask the buyer to refresh their Digital ID and scan again." },
        { status: 404 }
      );
    }
    const buyer = { id: student.id, name: student.name, nickname: student.nickname, studentId: student.studentId };

    if (body.action === "preview") {
      // Every paid-or-pending order of this buyer; filtered to the caller's
      // scope below, then split into "hand over now" and context.
      const rows = await db
        .select({
          id: shopOrders.id,
          fulfillment: shopOrders.fulfillment,
          fulfillmentStatus: shopOrders.fulfillmentStatus,
          status: shopOrders.status,
          totalAmount: shopOrders.totalAmount,
          createdAt: shopOrders.createdAt,
          fulfilledAt: shopOrders.fulfilledAt,
          fulfilledByName: fulfillers.name,
          sellerName: shopSellers.displayName,
        })
        .from(shopOrders)
        .leftJoin(shopSellers, eq(shopOrders.sellerId, shopSellers.id))
        .leftJoin(fulfillers, eq(shopOrders.fulfilledBy, fulfillers.id))
        .where(and(eq(shopOrders.buyerId, buyer.id), inArray(shopOrders.status, ["pending", "approved"])))
        .orderBy(desc(shopOrders.createdAt));

      let scopeInfo: Map<string, OrderScopeInfo> | null = null;
      if (!access.unscoped) scopeInfo = await classifyOrdersByScope(rows.map((r) => r.id), access.scope, access.sellerId);
      // Only orders the caller could hand over in full; a mixed order stays
      // with a shop admin, same as review.
      const visible = scopeInfo ? rows.filter((r) => scopeInfo!.get(r.id)?.fullyOwned && scopeInfo!.get(r.id)?.anyOwned) : rows;

      const items = visible.length
        ? await db
            .select({
              orderId: shopOrderItems.orderId,
              productName: shopOrderItems.productName,
              variantLabel: shopOrderItems.variantLabel,
              customValues: shopOrderItems.customValues,
              quantity: shopOrderItems.quantity,
            })
            .from(shopOrderItems)
            .where(inArray(shopOrderItems.orderId, visible.map((r) => r.id)))
        : [];
      const withItems: ScanOrder[] = visible.map((r) => ({
        ...r,
        sellerName: r.sellerName ?? "SMO / CAMT",
        items: items.filter((i) => i.orderId === r.id).map((i) => ({
          productName: i.productName,
          variantLabel: i.variantLabel,
          customValues: i.customValues ?? null,
          quantity: i.quantity,
        })),
      }));

      await AuditService.logAction({
        actorId: access.userId,
        targetId: buyer.id,
        action: `Scanned Digital ID at shop handover (${withItems.length} order(s) in scope)`,
        ipAddress: ip,
      });

      return NextResponse.json({
        buyer,
        // Paid and not yet in the buyer's hands → can be handed over now.
        ready: withItems.filter((o) => o.status === "approved" && nextFulfillmentStatus(o, "handover")),
        // Not paid yet → do NOT hand over; shown so staff can say why.
        unpaid: withItems.filter((o) => o.status === "pending"),
        // Already picked up / delivered → the "already collected" warning.
        done: withItems.filter((o) => o.status === "approved" && isFulfilled(o.fulfillmentStatus)).slice(0, 5),
      });
    }

    // confirm
    if (!body.orderIds?.length) return NextResponse.json({ error: "Choose at least one order to hand over." }, { status: 400 });
    const orderIds = [...new Set(body.orderIds)];
    if (!access.unscoped) {
      const scopeInfo = await classifyOrdersByScope(orderIds, access.scope, access.sellerId);
      if (orderIds.some((oid) => !scopeInfo.get(oid)?.anyOwned || !scopeInfo.get(oid)?.fullyOwned)) {
        return NextResponse.json({ error: "One of these orders isn't yours to hand over." }, { status: 403 });
      }
    }

    const handed = await db.transaction(async (tx) => {
      const locked = await tx
        .select({
          id: shopOrders.id,
          buyerId: shopOrders.buyerId,
          status: shopOrders.status,
          fulfillment: shopOrders.fulfillment,
          fulfillmentStatus: shopOrders.fulfillmentStatus,
        })
        .from(shopOrders)
        .where(inArray(shopOrders.id, orderIds))
        .for("update");
      if (locked.length !== orderIds.length || locked.some((o) => o.buyerId !== buyer.id)) {
        throw new ScanRefused("These orders don't belong to the scanned buyer.", 403);
      }
      const done: { id: string; fulfillmentStatus: string }[] = [];
      for (const o of locked) {
        const next = nextFulfillmentStatus(o, "handover");
        if (!next) {
          throw new ScanRefused(
            o.status !== "approved"
              ? "One of these orders hasn't been paid (approved) yet — don't hand it over."
              : "One of these orders was already handed over — scan again to refresh.",
            409
          );
        }
        await tx
          .update(shopOrders)
          .set(staffFulfillmentPatch({ action: "handover", from: o.fulfillmentStatus, next, actorId: access.userId, via: "qr", note: body.note }))
          .where(eq(shopOrders.id, o.id));
        await AuditService.logActionInternal(tx, {
          actorId: access.userId,
          targetId: o.id,
          action: `Handed over shop order ${o.id} by Digital ID scan [${o.fulfillmentStatus} → ${next}]`,
          ipAddress: ip,
        });
        done.push({ id: o.id, fulfillmentStatus: next });
      }
      return done;
    });

    return NextResponse.json({ success: true, buyer, handed });
  } catch (error) {
    if (error instanceof ScanRefused) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    captureException(error, { route: "POST /api/admin/shop/fulfillment/scan" });
    return NextResponse.json({ error: "Failed to record the handover" }, { status: 500 });
  }
}

class ScanRefused extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
