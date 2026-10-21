import { auth } from "@/auth";
import { buildViewer } from "@/lib/access/event-access";
import { readSlipAmounts } from "@/lib/shop/shop-slip-amount";
import { classifySlip, decodeSlipQr, hashSlip, verifySlipMeta } from "@/lib/shop/shop-slip-verify";
import { downloadSlip } from "@/lib/shop/shop-storage";
import { getShopOrderAudienceUserIds } from "@/modules/notifications/push-audience";
import { PushService } from "@/modules/notifications/push.service";
import { ShopOrdersService } from "@/modules/shop/shop-orders.service";
import { UsersService } from "@/modules/users/users.service";
import { after, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        // Required only when the chosen variant is an "Other (specify)" option.
        customValue: z.string().max(120).optional(),
        // Answers to the product's custom fields (key → value), validated
        // server-side against shop_products.custom_fields. See shop-custom-fields.ts.
        custom: z.record(z.string().max(40), z.string().max(500)).optional(),
      })
    )
    .min(1),
  // Object key from POST /api/shop/slip — server-generated "<uuid>.<ext>".
  slipPath: z.string().regex(/^[0-9a-f-]{36}\.(webp|gif|png|jpg|jpeg)$/i),
  // Signed hash/QR from that same upload response (see shop-slip-verify.ts) —
  // optional so an older cached client or a missing/expired token still works,
  // just via the slower re-download fallback below instead of failing outright.
  slipMeta: z.string().optional(),
  note: z.string().max(500).optional(),
  // Fulfillment. Recipient fields are required (server-side) only for delivery.
  fulfillment: z.enum(["pickup", "delivery"]).default("pickup"),
  recipientName: z.string().max(120).optional(),
  recipientPhone: z.string().max(40).optional(),
  shippingAddress: z.string().max(1000).optional(),
});

// GET /api/shop/orders — the signed-in buyer's own orders, newest first.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const buyerId = session.user.id!;

    // Complete this buyer's mailed orders past the auto-confirm window before
    // reading them (no scheduler on the self-hosted deploy — see the helper).
    await ShopOrdersService.autoConfirmDueShipmentsForBuyer(buyerId);

    const orders = await ShopOrdersService.listOrdersForBuyer(buyerId);

    const orderIds = orders.map((o) => o.id);
    const sellerIds = [...new Set(orders.map((o) => o.sellerId).filter((id): id is string => !!id))];
    const sellers = sellerIds.length
      ? await ShopOrdersService.listSellerPickupInfo(sellerIds)
      : [];
    const sellerNameById = new Map(sellers.map((seller) => [seller.id, seller.displayName]));
    const sellerPickupById = new Map(sellers.map((seller) => [seller.id, seller.pickupInfo]));
    // Central (SMO) orders fall back to the shop-wide pickup instructions.
    const centralPickupInfo = orders.some((o) => !o.sellerId && o.fulfillment === "pickup")
      ? await ShopOrdersService.getCentralPickupInfo()
      : "";
    const items = orderIds.length
      ? await ShopOrdersService.listItemsForOrders(orderIds)
      : [];

    const result = orders.map((o) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
      note: o.note,
      rejectionReason: o.rejectionReason,
      hasSlip: Boolean(o.slipPath),
      createdAt: o.createdAt,
      fulfillment: o.fulfillment,
      shippingFee: o.shippingFee,
      discountAmount: o.discountAmount,
      recipientName: o.recipientName,
      recipientPhone: o.recipientPhone,
      shippingAddress: o.shippingAddress,
      sellerName: o.sellerId ? sellerNameById.get(o.sellerId) ?? null : "SMO / CAMT",
      // Handover tracking (see src/lib/shop-fulfillment.ts). shippedBy /
      // fulfilledBy (staff ids) are deliberately not exposed to the buyer.
      fulfillmentStatus: o.fulfillmentStatus,
      pickupInfo: o.fulfillment === "pickup" ? (o.sellerId ? sellerPickupById.get(o.sellerId) ?? "" : centralPickupInfo) : null,
      readyAt: o.readyAt,
      carrier: o.carrier,
      carrierName: o.carrierName,
      trackingNumber: o.trackingNumber,
      trackingUrl: o.trackingUrl,
      shippedAt: o.shippedAt,
      fulfilledAt: o.fulfilledAt,
      fulfilledVia: o.fulfilledVia,
      issueNote: o.issueNote,
      issueAt: o.issueAt,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          productName: i.productName,
          variantLabel: i.variantLabel,
          customValues: i.customValues ?? null,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          handedOverAt: i.handedOverAt,
        })),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/shop/orders — place an order. Enforces per-variant stock and per-buyer
// limits atomically: the variant rows are locked FOR UPDATE so two concurrent
// buyers can't both slip past the last unit (same approach as event registration).
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const buyerId = session.user.id!;

    const data = orderSchema.parse(await req.json());

    // Free, offline slip pre-filter (see shop-slip-verify.ts) — done up front, outside
    // the transaction below, since it must not hold the variant row locks the
    // transaction takes. Doesn't block order creation on its own; it only sets a
    // flag for the admin review queue to surface.
    //
    // The hash/QR were already computed once at upload time (POST /api/shop/slip),
    // signed into data.slipMeta — trust that instead of re-downloading the image
    // from storage just to recompute the same thing. Only fall back to the
    // download+recompute path if the token is missing/expired/invalid, so a stale
    // client or an expired token degrades gracefully rather than failing the order.
    let slipHash: string;
    let slipQrPayload: string | null;
    let slipAmounts: number[] | null;
    const carried = verifySlipMeta(data.slipPath, data.slipMeta);
    if (carried) {
      ({ slipHash, slipQrPayload, slipAmounts } = carried);
    } else {
      let slipBuffer: Buffer;
      try {
        ({ buffer: slipBuffer } = await downloadSlip(data.slipPath));
      } catch (e) {
        console.error("Slip lookup failed for order creation:", e);
        return NextResponse.json({ error: "Payment slip not found. Please upload it again." }, { status: 400 });
      }
      slipHash = hashSlip(slipBuffer);
      slipQrPayload = await decodeSlipQr(slipBuffer);
      slipAmounts = await readSlipAmounts(slipBuffer);
    }
    const priorSlips = await ShopOrdersService.listPriorSlips();
    const slipFlag = classifySlip({ slipHash, slipQrPayload }, priorSlips);

    // Consolidate duplicate lines so a variant is checked once with its full qty.
    const qtyByVariant = new Map<string, number>();
    const customByVariant = new Map<string, string>();
    // Custom-field answers are per product but submitted per item (by variant);
    // keep the first set seen for each variant (the UI sends one item per order).
    const customFieldsByVariant = new Map<string, Record<string, string>>();
    for (const item of data.items) {
      qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.quantity);
      if (item.customValue?.trim()) customByVariant.set(item.variantId, item.customValue.trim());
      if (item.custom && !customFieldsByVariant.has(item.variantId)) customFieldsByVariant.set(item.variantId, item.custom);
    }
    const variantIds = [...qtyByVariant.keys()];

    // Buyer's audience profile, for the per-product visibility re-check below
    // (defence-in-depth: the storefront already hides ineligible products).
    const me = await UsersService.getMajorById(buyerId);
    const viewer = buildViewer({
      roles: session.user.roles || [session.user.role || "student"],
      studentId: session.user.studentId,
      major: me?.major,
    });

    const created = await ShopOrdersService.createOrder({
      buyerId,
      viewer,
      data,
      variantIds,
      qtyByVariant,
      customByVariant,
      customFieldsByVariant,
      slipHash,
      slipQrPayload,
      slipAmounts,
      slipFlag,
    });

    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: created.status });
    }

    after(async () => {
      const audienceIds = await getShopOrderAudienceUserIds(created.productIds, created.sellerId);
      await PushService.sendToUserIds(audienceIds, {
        title: "New shop order",
        body: "A new order is waiting for review.",
        url: "/admin/shop",
        tag: `shop-order:${created.orderId}`,
      });
    });

    return NextResponse.json({ success: true, orderId: created.orderId }, { status: 201 });
  } catch (error) {
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
