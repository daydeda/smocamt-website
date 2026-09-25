import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders } from "@/db/schema";
import { nextFulfillmentStatus } from "@/lib/shop-fulfillment";
import { getShopOrderAudienceUserIds } from "@/modules/notifications/push-audience";
import { PushService } from "@/modules/notifications/push.service";
import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  // A problem report must say what's wrong — it's what the seller acts on.
  z.object({ action: z.literal("report"), note: z.string().trim().min(1).max(500) }),
]);

// PATCH /api/shop/orders/[id]/fulfillment — the buyer's side of a mailed order:
// "I received it" (shipped/issue → delivered) or "Report a problem"
// (shipped → issue, which also stops the auto-confirm clock). Only the buyer's
// own order; anything else is a 404 so order ids can't be probed.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const buyerId = session.user.id;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = schema.parse(await req.json());

    const outcome = await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          status: shopOrders.status,
          fulfillment: shopOrders.fulfillment,
          fulfillmentStatus: shopOrders.fulfillmentStatus,
          sellerId: shopOrders.sellerId,
        })
        .from(shopOrders)
        .where(and(eq(shopOrders.id, id), eq(shopOrders.buyerId, buyerId)))
        .limit(1)
        .for("update");
      if (!order) return { kind: "not_found" as const };

      const next = nextFulfillmentStatus(order, data.action);
      if (!next) return { kind: "refused" as const };

      const now = new Date();
      await tx
        .update(shopOrders)
        .set(data.action === "confirm"
          ? { fulfillmentStatus: next, fulfilledAt: now, fulfilledBy: null, fulfilledVia: "buyer", updatedAt: now }
          : { fulfillmentStatus: next, issueNote: data.note, issueAt: now, updatedAt: now })
        .where(eq(shopOrders.id, id));
      return { kind: "ok" as const, next, sellerId: order.sellerId };
    });

    if (outcome.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (outcome.kind === "refused") {
      return NextResponse.json({ error: "This order can't be updated right now — refresh and try again." }, { status: 409 });
    }

    if (data.action === "report") {
      // Same audience as a new order: shop admins + whoever owns these products.
      after(async () => {
        const items = await db.select({ productId: shopOrderItems.productId }).from(shopOrderItems).where(eq(shopOrderItems.orderId, id));
        const audienceIds = await getShopOrderAudienceUserIds(
          items.map((i) => i.productId).filter((p): p is string => !!p),
          outcome.sellerId,
        );
        await PushService.sendToUserIds(audienceIds, {
          title: "Delivery problem reported",
          // No buyer free-text on a lock screen — the note is shown in-app.
          body: "A buyer reported a problem with a shipped order.",
          url: "/admin/shop",
          tag: `shop-order-issue:${id}`,
        });
      });
    }

    return NextResponse.json({ success: true, fulfillmentStatus: outcome.next });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Please describe the problem." }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
