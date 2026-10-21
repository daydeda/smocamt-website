import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, shopSellers, shopSettings, shopVariants } from "@/db/schema";
import { isEligibleFor, type Viewer } from "@/lib/access/event-access";
import { validateCustomAnswers } from "@/lib/shop/shop-custom-fields";
import { computeProductDeliveryFee } from "@/lib/shop/shop-delivery";
import { computeBundleDiscount } from "@/lib/shop/shop-promotions";
import { nextFulfillmentStatus } from "@/lib/shop/shop-fulfillment";
import { autoConfirmDueShipments } from "@/lib/shop/shop-fulfillment-server";
import { classifySlipAmount } from "@/lib/shop/shop-slip-amount";
import { classifySlip } from "@/lib/shop/shop-slip-verify";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

// Advisory-lock namespace (int4) for serializing a single buyer's concurrent shop
// orders; paired with hashtext(buyerId). Distinct lock space from the audit chain's
// single-key advisory lock, so the two never collide.
const SHOP_BUYER_LOCK_NS = 53201;

export class ShopOrdersService {
  /** Slip hash / QR payload of every non-rejected order (duplicate-slip pre-filter). */
  static async listPriorSlips() {
    return db
      .select({ slipHash: shopOrders.slipHash, slipQrPayload: shopOrders.slipQrPayload })
      .from(shopOrders)
      .where(ne(shopOrders.status, "rejected"));
  }

  /** The buyer's own orders, newest first. */
  static async listOrdersForBuyer(buyerId: string) {
    return db
      .select()
      .from(shopOrders)
      .where(eq(shopOrders.buyerId, buyerId))
      .orderBy(desc(shopOrders.createdAt));
  }

  /** Display name + pickup instructions of the given sellers. */
  static async listSellerPickupInfo(sellerIds: string[]) {
    return db
      .select({ id: shopSellers.id, displayName: shopSellers.displayName, pickupInfo: shopSellers.pickupInfo })
      .from(shopSellers)
      .where(inArray(shopSellers.id, sellerIds));
  }

  /** Shop-wide pickup instructions (central/SMO orders fall back to these). */
  static async getCentralPickupInfo() {
    return (await db.select({ pickupInfo: shopSettings.pickupInfo }).from(shopSettings).orderBy(desc(shopSettings.updatedAt)).limit(1))[0]?.pickupInfo ?? "";
  }

  /** Line items of the given orders. */
  static async listItemsForOrders(orderIds: string[]) {
    return db.select().from(shopOrderItems).where(inArray(shopOrderItems.orderId, orderIds));
  }

  /** product ids of one order's line items. */
  static async listProductIdsForOrder(orderId: string) {
    return db.select({ productId: shopOrderItems.productId }).from(shopOrderItems).where(eq(shopOrderItems.orderId, orderId));
  }

  /** Buyer + slip path of one order (slip view). */
  static async getOrderSlipRef(orderId: string) {
    const [order] = await db
      .select({ buyerId: shopOrders.buyerId, slipPath: shopOrders.slipPath })
      .from(shopOrders)
      .where(eq(shopOrders.id, orderId))
      .limit(1);
    return order;
  }

  /**
   * The buyer's side of a mailed order: "I received it" (confirm) or "Report a
   * problem" (report), under a row lock. Only the buyer's own order matches.
   */
  static async applyBuyerFulfillmentAction(
    id: string,
    buyerId: string,
    data: { action: "confirm" } | { action: "report"; note: string },
  ) {
    return db.transaction(async (tx) => {
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
  }

  /**
   * Places an order. Enforces per-variant stock and per-buyer limits atomically:
   * the variant rows are locked FOR UPDATE so two concurrent buyers can't both
   * slip past the last unit (same approach as event registration). Returns
   * { error, status } for a refused order or { orderId, ... } on success.
   */
  static async createOrder(params: {
    buyerId: string;
    viewer: Viewer;
    data: {
      slipPath: string;
      note?: string;
      fulfillment: "pickup" | "delivery";
      recipientName?: string;
      recipientPhone?: string;
      shippingAddress?: string;
    };
    variantIds: string[];
    qtyByVariant: Map<string, number>;
    customByVariant: Map<string, string>;
    customFieldsByVariant: Map<string, Record<string, string>>;
    slipHash: string;
    slipQrPayload: string | null;
    slipAmounts: number[] | null;
    slipFlag: ReturnType<typeof classifySlip>;
  }) {
    const {
      buyerId, viewer, data, variantIds, qtyByVariant, customByVariant, customFieldsByVariant,
      slipHash, slipQrPayload, slipAmounts, slipFlag,
    } = params;
    return db.transaction(async (tx) => {
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

      const sellerKeys = new Set(products.map((product) => product.sellerId ?? "central"));
      if (sellerKeys.size !== 1) {
        return { error: "Items from different sellers must be placed as separate orders.", status: 400 as const };
      }
      const sellerId = products[0]?.sellerId ?? null;
      const [seller] = sellerId
        ? await tx
            .select({
              status: shopSellers.status,
              deliveryEnabled: shopSellers.deliveryEnabled,
              deliveryFee: shopSellers.deliveryFee,
            })
            .from(shopSellers)
            .where(eq(shopSellers.id, sellerId))
            .limit(1)
            // Serialize against approve/reject/suspend, which takes FOR UPDATE
            // on this seller row, so an order cannot race through suspension.
            .for("share")
        : [null];
      if (sellerId && seller?.status !== "approved") {
        return { error: "This seller is not accepting orders right now.", status: 403 as const };
      }

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
        if (!product || !product.isActive || product.approvalStatus !== "approved" || !isEligibleFor(product, viewer)) {
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

      // Bundle promotions ("buy N for ฿X") — counted per product across the
      // eligible options in THIS order. A deal's reference price is its cheapest
      // eligible option, so it needs ALL of the product's options, not just the
      // ordered ones. Server-authoritative; lines keep full unitPrice, and the
      // saving is snapshotted on the order.
      let discountAmount = 0;
      const productsWithDeals = productIds.filter((pid) => (productById.get(pid)!.bundleDeals ?? []).length > 0);
      if (productsWithDeals.length) {
        const allVariants = await tx
          .select({ id: shopVariants.id, productId: shopVariants.productId, priceDelta: shopVariants.priceDelta })
          .from(shopVariants)
          .where(inArray(shopVariants.productId, productsWithDeals));
        for (const pid of productsWithDeals) {
          discountAmount += computeBundleDiscount(
            productById.get(pid)!,
            allVariants.filter((v) => v.productId === pid),
            qtyByVariant
          );
        }
      }
      total -= discountAmount;

      // Fulfillment + flat delivery fee (server-authoritative; never trust the
      // client's fee). Delivery requires the shop to allow it + a complete address.
      let shippingFee = 0;
      let recipientName: string | null = null;
      let recipientPhone: string | null = null;
      let shippingAddress: string | null = null;
      if (data.fulfillment === "delivery") {
        const deliveryEnabled = sellerId ? seller!.deliveryEnabled : settings.deliveryEnabled;
        const defaultDeliveryFee = sellerId ? seller!.deliveryFee : settings.deliveryFee;
        if (!deliveryEnabled) {
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
          shippingFee += computeProductDeliveryFee(product, requestedByProduct.get(pid) ?? 0, defaultDeliveryFee);
        }
      }
      total += shippingFee;

      const [order] = await tx
        .insert(shopOrders)
        .values({
          buyerId,
          sellerId,
          status: "pending",
          slipPath: data.slipPath,
          slipHash,
          slipQrPayload,
          // Duplicate/no-QR outrank an amount mismatch: reuse is the stronger signal.
          // The total is only final here, after discount + shipping.
          slipFlag: slipFlag ?? classifySlipAmount(total, slipAmounts),
          totalAmount: total,
          note: data.note ?? null,
          fulfillment: data.fulfillment,
          recipientName,
          recipientPhone,
          shippingAddress,
          shippingFee,
          discountAmount,
        })
        .returning({ id: shopOrders.id });

      await tx.insert(shopOrderItems).values(lines.map((l) => ({ ...l, orderId: order.id })));

      return { orderId: order.id, status: 201 as const, productIds, sellerId };
    });
  }

  /**
   * Completes this buyer's mailed orders past the auto-confirm window (no
   * scheduler on the self-hosted deploy — see the helper).
   */
  static async autoConfirmDueShipmentsForBuyer(buyerId: string) {
    await autoConfirmDueShipments(eq(shopOrders.buyerId, buyerId));
  }

  /** Does an order with this id exist? (row with just the id, or undefined) */
  static async orderExists(id: string) {
    const [exists] = await db.select({ id: shopOrders.id }).from(shopOrders).where(eq(shopOrders.id, id)).limit(1);
    return exists;
  }
}
