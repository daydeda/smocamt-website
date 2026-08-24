import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, shopSettings, shopVariants, users } from "@/db/schema";
import { buildViewer, isEligibleFor } from "@/lib/event-access";
import { validateCustomAnswers } from "@/lib/shop-custom-fields";
import { computeProductDeliveryFee } from "@/lib/shop-delivery";
import { classifySlip, decodeSlipQr, hashSlip } from "@/lib/shop-slip-verify";
import { downloadSlip } from "@/lib/shop-storage";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Advisory-lock namespace (int4) for serializing a single buyer's concurrent shop
// orders; paired with hashtext(buyerId). Distinct lock space from the audit chain's
// single-key advisory lock, so the two never collide.
const SHOP_BUYER_LOCK_NS = 53201;

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

    const orders = await db
      .select()
      .from(shopOrders)
      .where(eq(shopOrders.buyerId, buyerId))
      .orderBy(desc(shopOrders.createdAt));

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
      createdAt: o.createdAt,
      fulfillment: o.fulfillment,
      shippingFee: o.shippingFee,
      recipientName: o.recipientName,
      recipientPhone: o.recipientPhone,
      shippingAddress: o.shippingAddress,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          productName: i.productName,
          variantLabel: i.variantLabel,
          customValues: i.customValues ?? null,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
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
    // the transaction below, since it's I/O + CPU (download + sharp/jsQR decode) and
    // must not hold the variant row locks the transaction takes. Doesn't block order
    // creation on its own; it only sets a flag for the admin review queue to surface.
    let slipBuffer: Buffer;
    try {
      ({ buffer: slipBuffer } = await downloadSlip(data.slipPath));
    } catch (e) {
      console.error("Slip lookup failed for order creation:", e);
      return NextResponse.json({ error: "Payment slip not found. Please upload it again." }, { status: 400 });
    }
    const slipHash = hashSlip(slipBuffer);
    const slipQrPayload = await decodeSlipQr(slipBuffer);
    const priorSlips = await db
      .select({ slipHash: shopOrders.slipHash, slipQrPayload: shopOrders.slipQrPayload })
      .from(shopOrders)
      .where(ne(shopOrders.status, "rejected"));
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
    const me = await db.query.users.findFirst({
      where: eq(users.id, buyerId),
      columns: { major: true },
    });
    const viewer = buildViewer({
      roles: session.user.roles || [session.user.role || "student"],
      studentId: session.user.studentId,
      major: me?.major,
    });

    const created = await db.transaction(async (tx) => {
      // Serialize this buyer's concurrent orders so the per-product maxPerOrder cap
      // can't be bypassed by firing two orders for DIFFERENT variants of the same
      // product at once: the per-variant FOR UPDATE locks below don't overlap across
      // variants, so the two transactions wouldn't see each other's pending qty in
      // ownedByProduct. A per-buyer lock makes the owned/requested check consistent.
      // Keyed on the buyer only — never blocks different buyers. Released at tx end.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SHOP_BUYER_LOCK_NS}, hashtext(${buyerId}))`);

      const [settings] = await tx
        .select({ enabled: shopSettings.enabled, deliveryEnabled: shopSettings.deliveryEnabled, deliveryFee: shopSettings.deliveryFee })
        .from(shopSettings)
        .orderBy(desc(shopSettings.updatedAt))
        .limit(1);
      if (!settings || !settings.enabled) {
        return { error: "The shop is currently closed.", status: 403 as const };
      }

      // Lock the variant rows to serialize concurrent stock checks.
      const variants = await tx
        .select()
        .from(shopVariants)
        .where(inArray(shopVariants.id, variantIds))
        .for("update");

      if (variants.length !== variantIds.length) {
        return { error: "One of the selected items no longer exists.", status: 400 as const };
      }

      const productIds = [...new Set(variants.map((v) => v.productId))];
      const products = await tx
        .select()
        .from(shopProducts)
        .where(inArray(shopProducts.id, productIds));
      const productById = new Map(products.map((p) => [p.id, p]));

      // Units already committed (non-rejected) per variant, for the stock check.
      const soldRows = await tx
        .select({
          variantId: shopOrderItems.variantId,
          sold: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)`,
        })
        .from(shopOrderItems)
        .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
        .where(and(inArray(shopOrderItems.variantId, variantIds), ne(shopOrders.status, "rejected")))
        .groupBy(shopOrderItems.variantId);
      const soldByVariant = new Map(soldRows.map((r) => [r.variantId, Number(r.sold)]));

      // Units this buyer already holds (non-rejected) per product, for the limit.
      const ownedRows = await tx
        .select({
          productId: shopOrderItems.productId,
          owned: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)`,
        })
        .from(shopOrderItems)
        .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
        .where(and(eq(shopOrders.buyerId, buyerId), ne(shopOrders.status, "rejected"), inArray(shopOrderItems.productId, productIds)))
        .groupBy(shopOrderItems.productId);
      const ownedByProduct = new Map(ownedRows.map((r) => [r.productId, Number(r.owned)]));

      // Requested qty per product (across its variants) for the per-buyer limit.
      const requestedByProduct = new Map<string, number>();
      for (const v of variants) {
        const q = qtyByVariant.get(v.id)!;
        requestedByProduct.set(v.productId, (requestedByProduct.get(v.productId) ?? 0) + q);
      }

      const lines: (typeof shopOrderItems.$inferInsert)[] = [];
      let total = 0;

      for (const v of variants) {
        const product = productById.get(v.productId);
        if (!product || !product.isActive || !isEligibleFor(product, viewer)) {
          return { error: `"${product?.name ?? "An item"}" is no longer available.`, status: 400 as const };
        }
        // Sale window (server-authoritative — the client also hides it, but never trust that).
        const now = new Date();
        if (product.opensAt && now < product.opensAt) {
          return { error: `${product.name} is not on sale yet.`, status: 409 as const };
        }
        if (product.closesAt && now > product.closesAt) {
          return { error: `Sales for ${product.name} have closed.`, status: 409 as const };
        }
        const qty = qtyByVariant.get(v.id)!;

        // "Other (specify)" — the buyer's typed value is required and gets baked
        // into the snapshot label so it shows on both the buyer's and admin's view.
        let variantLabel = v.label;
        if (v.allowCustom) {
          const custom = customByVariant.get(v.id);
          if (!custom) {
            return { error: `Please specify a value for "${v.label}" on ${product.name}.`, status: 400 as const };
          }
          variantLabel = `${v.label}: ${custom}`;
        }

        // Custom fields (e.g. jersey name/number) — validated against the product's
        // config and snapshotted onto the line. Server-authoritative.
        const customResult = validateCustomAnswers(product.customFields, customFieldsByVariant.get(v.id), product.name);
        if (!customResult.ok) {
          return { error: customResult.error, status: 400 as const };
        }

        // Stock cap (per variant).
        if (v.stock != null) {
          const remaining = v.stock - (soldByVariant.get(v.id) ?? 0);
          if (qty > remaining) {
            return {
              error: `Not enough stock for ${product.name} (${v.label}). Only ${Math.max(0, remaining)} left.`,
              status: 409 as const,
            };
          }
        }

        // Per-buyer limit (across the whole product).
        if (product.maxPerOrder != null) {
          const owned = ownedByProduct.get(product.id) ?? 0;
          const requested = requestedByProduct.get(product.id) ?? 0;
          if (owned + requested > product.maxPerOrder) {
            const allowance = product.maxPerOrder - owned;
            return {
              error: `You can order at most ${product.maxPerOrder} of ${product.name}` +
                (owned > 0 ? ` (you already have ${owned}; ${Math.max(0, allowance)} more allowed).` : "."),
              status: 409 as const,
            };
          }
        }

        // Resolved unit price = base product price + this variant's surcharge
        // (e.g. a special/larger size). Server-authoritative; never trust a client
        // price. Snapshotted onto the line so later edits don't move this order.
        const unitPrice = product.price + (v.priceDelta ?? 0);
        total += unitPrice * qty;
        lines.push({
          orderId: "", // filled after the order row is created
          productId: product.id,
          variantId: v.id,
          productName: product.name,
          variantLabel,
          customValues: customResult.snapshot.length ? customResult.snapshot : null,
          unitPrice,
          quantity: qty,
        });
      }

      // Fulfillment + flat delivery fee (server-authoritative; never trust the
      // client's fee). Delivery requires the shop to allow it + a complete address.
      let shippingFee = 0;
      let recipientName: string | null = null;
      let recipientPhone: string | null = null;
      let shippingAddress: string | null = null;
      if (data.fulfillment === "delivery") {
        if (!settings.deliveryEnabled) {
          return { error: "Delivery isn't available right now.", status: 403 as const };
        }
        recipientName = data.recipientName?.trim() || "";
        recipientPhone = data.recipientPhone?.trim() || "";
        shippingAddress = data.shippingAddress?.trim() || "";
        if (!recipientName || !recipientPhone || !shippingAddress) {
          return { error: "Please fill in the recipient name, phone, and delivery address.", status: 400 as const };
        }
        // Sum each product's fee, computed from its own base/tiers by the ordered
        // quantity (highest applicable tier wins), falling back to the shop-wide fee.
        for (const pid of productIds) {
          const product = productById.get(pid)!;
          shippingFee += computeProductDeliveryFee(product, requestedByProduct.get(pid) ?? 0, settings.deliveryFee);
        }
      }
      total += shippingFee;

      const [order] = await tx
        .insert(shopOrders)
        .values({
          buyerId,
          status: "pending",
          slipPath: data.slipPath,
          slipHash,
          slipQrPayload,
          slipFlag,
          totalAmount: total,
          note: data.note ?? null,
          fulfillment: data.fulfillment,
          recipientName,
          recipientPhone,
          shippingAddress,
          shippingFee,
        })
        .returning({ id: shopOrders.id });

      await tx.insert(shopOrderItems).values(lines.map((l) => ({ ...l, orderId: order.id })));

      return { orderId: order.id, status: 201 as const };
    });

    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: created.status });
    }
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
