import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrders } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop-scope";
import { carrierLabel, nextFulfillmentStatus, validateShipment, type ShipmentValue } from "@/lib/shop-fulfillment";
import { SHIPMENT_ERROR_MESSAGE, staffFulfillmentPatch } from "@/lib/shop-fulfillment-server";
import { PushService } from "@/modules/notifications/push.service";
import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["ready", "ship", "handover", "reset"]),
  // ship only
  carrier: z.string().max(40).optional(),
  carrierName: z.string().max(80).optional(),
  trackingNumber: z.string().max(80).optional(),
  trackingUrl: z.string().max(1000).optional(),
  // handover only (e.g. "collected by a friend")
  note: z.string().max(500).optional(),
});

const LABEL = {
  ready: "Marked ready for pickup",
  ship: "Marked shipped",
  handover: "Marked handed over (manual)",
  reset: "Reset fulfilment of",
} as const;

class TransitionRefused extends Error {}

// PATCH /api/admin/shop/orders/[id]/fulfillment — the per-order handover buttons
// on the admin order card: ready-for-pickup, mark shipped (carrier + tracking),
// handed over (manual fallback to the Digital ID scanner), and reset (undo).
// Same scope rule as payment review: a scoped seller/president may act only on
// an order whose every line item is theirs.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = schema.parse(await req.json());

    let shipment: ShipmentValue | undefined;
    if (data.action === "ship") {
      const v = validateShipment({
        carrier: data.carrier ?? "",
        carrierName: data.carrierName,
        trackingNumber: data.trackingNumber,
        trackingUrl: data.trackingUrl,
      });
      if (!v.ok) return NextResponse.json({ error: SHIPMENT_ERROR_MESSAGE[v.error], code: v.error }, { status: 400 });
      shipment = v.value;
    }

    const [exists] = await db.select({ id: shopOrders.id }).from(shopOrders).where(eq(shopOrders.id, id)).limit(1);
    if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!access.unscoped) {
      const info = (await classifyOrdersByScope([id], access.scope, access.sellerId)).get(id);
      if (!info?.anyOwned) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!info.fullyOwned) {
        return NextResponse.json(
          { error: "This order also contains items managed by another team — a shop admin must hand it over." },
          { status: 403 }
        );
      }
    }

    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          buyerId: shopOrders.buyerId,
          status: shopOrders.status,
          fulfillment: shopOrders.fulfillment,
          fulfillmentStatus: shopOrders.fulfillmentStatus,
        })
        .from(shopOrders)
        .where(eq(shopOrders.id, id))
        .limit(1)
        .for("update");
      if (!order) throw new TransitionRefused("Not found");

      const next = nextFulfillmentStatus(order, data.action);
      if (!next) {
        throw new TransitionRefused(
          order.status !== "approved"
            ? "This order hasn't been approved (paid) yet."
            : "This order can't do that in its current state — refresh the list and try again."
        );
      }

      await tx
        .update(shopOrders)
        .set(staffFulfillmentPatch({
          action: data.action,
          from: order.fulfillmentStatus,
          next,
          actorId: access.userId,
          via: "manual",
          shipment,
          note: data.note,
        }))
        .where(eq(shopOrders.id, id));

      const detail = shipment
        ? ` (${carrierLabel(shipment.carrier, shipment.carrierName, false)}${shipment.trackingNumber ? ` ${shipment.trackingNumber}` : ""})`
        : "";
      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        targetId: id,
        action: `${LABEL[data.action]} shop order ${id}${detail} [${order.fulfillmentStatus} → ${next}]`,
        ipAddress: getClientIp(req),
      });

      return { buyerId: order.buyerId, next, from: order.fulfillmentStatus };
    });

    // Tell the buyer when there's something for them to do: come and collect,
    // or watch for a parcel. A tracking-number correction (shipped → shipped)
    // re-sends so they get the fixed number.
    if (data.action === "ready" || data.action === "ship") {
      after(async () => {
        await PushService.sendToUserIds([result.buyerId], data.action === "ready"
          ? { title: "Ready for pickup", body: "Your shop order is ready to collect. Open the app for where and when.", url: "/dashboard/shop", tag: `shop-order-fulfil:${id}` }
          : { title: "Order shipped", body: "Your shop order is on its way. Open the app for the tracking number.", url: "/dashboard/shop", tag: `shop-order-fulfil:${id}` });
      });
    }

    return NextResponse.json({ success: true, fulfillmentStatus: result.next });
  } catch (error) {
    if (error instanceof TransitionRefused) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Not found" ? 404 : 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
