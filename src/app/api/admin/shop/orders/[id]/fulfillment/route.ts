import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { ShopAdminService, TransitionRefused } from "@/modules/shop/shop-admin.service";
import { ShopOrdersService } from "@/modules/shop/shop-orders.service";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop/shop-scope";
import { validateShipment, type ShipmentValue } from "@/lib/shop/shop-fulfillment";
import { HandoverRefused, SHIPMENT_ERROR_MESSAGE } from "@/lib/shop/shop-fulfillment-server";
import { PushService } from "@/modules/notifications/push.service";
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
  // handover only: which lines are being handed over (the card's checklist),
  // and an optional note (e.g. "collected by a friend").
  itemIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  note: z.string().max(500).optional(),
});

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
    if (data.action === "handover" && !data.itemIds?.length) {
      return NextResponse.json({ error: "Tick the items you're handing over." }, { status: 400 });
    }

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

    const exists = await ShopOrdersService.orderExists(id);
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

    if (data.action === "handover") {
      const changes = await ShopAdminService.handOverItemsManually({
        itemIds: data.itemIds!,
        orderId: id,
        actorId: access.userId,
        note: data.note,
        ip: getClientIp(req),
      });
      return NextResponse.json({ success: true, fulfillmentStatus: changes[0]?.next });
    }

    const result = await ShopAdminService.applyStaffTransition({
      id,
      action: data.action,
      shipment,
      note: data.note,
      actorId: access.userId,
      ipAddress: getClientIp(req),
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
    if (error instanceof HandoverRefused) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
