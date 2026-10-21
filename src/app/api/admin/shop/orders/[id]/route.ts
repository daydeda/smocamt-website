import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop/shop-scope";
import { PushService } from "@/modules/notifications/push.service";
import {
  EditConflict,
  EditValidation,
  FulfilledConflict,
  RevertConflict,
  SellerInactive,
  ShopOrderReviewService,
} from "@/modules/shop/shop-order-review.service";
import { ShopOrdersService } from "@/modules/shop/shop-orders.service";
import { after, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  // "revert" sends an already-reviewed order back to pending so it can be re-checked.
  action: z.enum(["approve", "reject", "revert"]),
  rejectionReason: z.string().max(500).optional(),
});

const STATUS_BY_ACTION = { approve: "approved", reject: "rejected", revert: "pending" } as const;

const editSchema = z.object({
  note: z.string().max(500).optional(),
  recipientName: z.string().max(120).optional(),
  recipientPhone: z.string().max(40).optional(),
  shippingAddress: z.string().max(1000).optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        // Swapping the variant is scoped to "pick the right option" — the new
        // variant must belong to the SAME product as the item being edited.
        variantId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        // Required only when the chosen variant is an "Other (specify)" option.
        customValue: z.string().max(120).optional(),
        custom: z.record(z.string().max(40), z.string().max(500)).optional(),
      })
    )
    .min(1)
    .max(20),
});

// PATCH /api/admin/shop/orders/[id] — approve or reject an order after viewing the
// slip. Rejecting frees the reserved stock automatically (the sold/owned queries
// ignore rejected orders), so a rejected order's units become buyable again.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = reviewSchema.parse(await req.json());

    const order = await ShopOrdersService.orderExists(id);
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // A scoped president may review an order only when EVERY line item is for a
    // product their club/major owns — approve/reject/revert is order-wide (stock,
    // status), so a mixed-club order stays with an unscoped shop reviewer.
    if (!access.unscoped) {
      const info = (await classifyOrdersByScope([id], access.scope, access.sellerId)).get(id);
      if (!info?.anyOwned) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!info.fullyOwned) {
        return NextResponse.json(
          { error: "This order also contains items managed by another team — a shop admin must review it." },
          { status: 403 }
        );
      }
    }

    const newStatus = STATUS_BY_ACTION[data.action];
    const isRevert = data.action === "revert";

    await ShopOrderReviewService.reviewOrder({
      id,
      action: data.action,
      rejectionReason: data.rejectionReason,
      newStatus,
      isRevert,
      actorId: access.userId,
      ipAddress: getClientIp(req),
    });

    // "revert" just re-opens the order for review — nothing new to tell the buyer.
    if (data.action !== "revert") {
      after(async () => {
        const buyer = await ShopOrderReviewService.getBuyerId(id);
        if (!buyer) return;
        await PushService.sendToUserIds([buyer.buyerId], {
          title: data.action === "approve" ? "Order approved" : "Order rejected",
          // Deliberately never includes staff free-text (rejectionReason) in a
          // push body — it renders on a lock screen. Full detail stays in-app.
          body: data.action === "approve" ? "Your shop order was approved." : "Your shop order was rejected. Open the app for details.",
          url: "/dashboard/shop",
          tag: `shop-order-decision:${id}`,
        });
      });
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    if (error instanceof SellerInactive) {
      return NextResponse.json({ error: "This seller is not active; order review is temporarily frozen." }, { status: 409 });
    }
    if (error instanceof FulfilledConflict) {
      return NextResponse.json({ error: "This order was already shipped or handed over — undo that first (Reset handover), then review the payment again." }, { status: 409 });
    }
    if (error instanceof RevertConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
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

// PUT /api/admin/shop/orders/[id] — let a shop admin/owner correct an order's
// details after the fact (e.g. a buyer forgot to pick the right size, ordered
// the wrong number of units, or typo'd a jersey name). Editable at ANY status
// (pending/approved/rejected), because the whole point is fixing a mistake
// that's already been reviewed. Scoped to:
//   - per item: swap the VARIANT (must stay on the same product), its
//     quantity, and its "Other (specify)" text / custom-field answers — never
//     the product itself, and never adding/removing a line item, to keep
//     stock/shipping accounting simple and correct.
//   - order-level: note, and (delivery orders only) recipient name/phone/address.
// A variant swap re-prices the line off the LIVE product price
// (unitPrice = product.price + variant.priceDelta); a pure quantity change on
// an otherwise-untouched line keeps its original (historical) unitPrice, only
// the extended total moves. Either way, stock is re-validated for the new
// (variant, quantity) pair — same FOR UPDATE + oversell guard as revert. A
// quantity change on a delivery order also re-runs the per-product tiered
// delivery fee (computeProductDeliveryFee) for the order's new quantities,
// same as at checkout — but ONLY when a quantity actually changed, so an
// unrelated edit can't silently move a historically-snapshotted shippingFee.
// Deliberately does NOT re-check shop_products.maxPerOrder (the buyer-facing
// per-product cap) — this is an explicit admin correction, not a buyer
// self-service purchase, so that cap isn't re-enforced here.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = editSchema.parse(await req.json());

    const order = await ShopOrdersService.orderExists(id);
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Same scoping rule as review: a president may edit an order only when
    // EVERY line item is for a product their club/major owns.
    if (!access.unscoped) {
      const info = (await classifyOrdersByScope([id], access.scope, access.sellerId)).get(id);
      if (!info?.anyOwned) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!info.fullyOwned) {
        return NextResponse.json(
          { error: "This order also contains items managed by another team — a shop admin must edit it." },
          { status: 403 }
        );
      }
    }

    // Cheap pre-check outside the transaction, purely for a nicer error before
    // taking any locks — the transaction below re-reads the authoritative copy
    // under FOR UPDATE and is what every decision actually uses.
    const precheckItems = await ShopOrderReviewService.listItemProductRefs(id);
    for (const edit of data.items) {
      const cur = precheckItems.find((i) => i.id === edit.id);
      if (!cur) {
        return NextResponse.json({ error: "One of the order items was not found." }, { status: 404 });
      }
      if (!cur.productId) {
        return NextResponse.json(
          { error: "This line's product no longer exists, so its option can't be edited." },
          { status: 400 }
        );
      }
    }

    await ShopOrderReviewService.editOrder({
      id,
      data,
      actorId: access.userId,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SellerInactive) {
      return NextResponse.json({ error: "This seller is not active; order edits are temporarily frozen." }, { status: 409 });
    }
    if (error instanceof EditConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof EditValidation) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
