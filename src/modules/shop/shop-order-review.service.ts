import { db } from "@/db";
import { shopOrders, shopOrderItems, shopProducts, shopSellers, shopSettings, shopVariants } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { validateCustomAnswers } from "@/lib/shop/shop-custom-fields";
import { computeProductDeliveryFee } from "@/lib/shop/shop-delivery";
import { computeBundleDiscount } from "@/lib/shop/shop-promotions";
import { blocksPaymentReview } from "@/lib/shop/shop-fulfillment";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

const LABEL_BY_ACTION = { approve: "Approved", reject: "Rejected", revert: "Reverted to pending" } as const;

// Thrown inside the PATCH transaction when a "revert" would oversell stock.
export class RevertConflict extends Error {}
export class SellerInactive extends Error {}
// Thrown inside the PATCH transaction when the goods already left the seller.
export class FulfilledConflict extends Error {}
// Thrown inside the PUT (edit) transaction for a client-facing validation error.
export class EditValidation extends Error {}
// Thrown inside the PUT (edit) transaction when a variant swap would oversell stock.
export class EditConflict extends Error {}

export type OrderEditInput = {
  note?: string;
  recipientName?: string;
  recipientPhone?: string;
  shippingAddress?: string;
  items: {
    id: string;
    variantId: string;
    quantity: number;
    customValue?: string;
    custom?: Record<string, string>;
  }[];
};

export class ShopOrderReviewService {
  /** The buyer id of an order (for the post-review push). */
  static async getBuyerId(id: string) {
    const [buyer] = await db.select({ buyerId: shopOrders.buyerId }).from(shopOrders).where(eq(shopOrders.id, id)).limit(1);
    return buyer;
  }

  /** Cheap pre-check of an order's line items (id + productId) before the edit transaction takes locks. */
  static async listItemProductRefs(orderId: string) {
    return db
      .select({ id: shopOrderItems.id, productId: shopOrderItems.productId })
      .from(shopOrderItems)
      .where(eq(shopOrderItems.orderId, orderId));
  }

  /**
   * Approve / reject / revert an order's payment review under a row lock (and a
   * shared lock on the seller), with its audit log, in one transaction. Revert
   * re-validates stock. Throws FulfilledConflict, SellerInactive or RevertConflict.
   */
  static async reviewOrder(params: {
    id: string;
    action: "approve" | "reject" | "revert";
    rejectionReason?: string;
    newStatus: "approved" | "rejected" | "pending";
    isRevert: boolean;
    actorId: string;
    ipAddress: string;
  }) {
    const { id, action, rejectionReason, newStatus, isRevert, actorId, ipAddress } = params;
    await db.transaction(async (tx) => {
      // Lock the order and seller status for the whole review transaction.
      // Seller approval/suspension takes FOR UPDATE on the same seller row, so
      // neither operation can race past the other's decision.
      const [lockedOrder] = await tx
        .select({ sellerId: shopOrders.sellerId, fulfillmentStatus: shopOrders.fulfillmentStatus })
        .from(shopOrders)
        .where(eq(shopOrders.id, id))
        .limit(1)
        .for("update");
      // Rejecting/reverting an order that was already shipped or handed over
      // would leave "rejected" + "picked up" on the same row. The seller undoes
      // the handover first (Reset on the card), then re-reviews the payment.
      if (action !== "approve" && lockedOrder && blocksPaymentReview(lockedOrder.fulfillmentStatus)) {
        throw new FulfilledConflict();
      }
      if (lockedOrder?.sellerId) {
        const [seller] = await tx
          .select({ status: shopSellers.status })
          .from(shopSellers)
          .where(eq(shopSellers.id, lockedOrder.sellerId))
          .limit(1)
          .for("share");
        if (seller?.status !== "approved") throw new SellerInactive();
      }

      // Reverting a rejected order back to 'pending' RE-COMMITS its reserved units.
      // Stock = variant.stock − Σ(qty of non-rejected orders); this order is still
      // 'rejected' here (excluded from that sum), so without a re-check the revert
      // could push a variant past its stock if other orders consumed the freed units
      // in the meantime. Re-validate under a FOR UPDATE lock (mirrors order
      // placement) and refuse the revert if it would oversell.
      if (isRevert) {
        const items = await tx
          .select({ variantId: shopOrderItems.variantId, quantity: shopOrderItems.quantity })
          .from(shopOrderItems)
          .where(eq(shopOrderItems.orderId, id));
        const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v))];
        if (variantIds.length > 0) {
          const variants = await tx
            .select({ id: shopVariants.id, stock: shopVariants.stock, label: shopVariants.label })
            .from(shopVariants)
            .where(inArray(shopVariants.id, variantIds))
            .for("update");
          const stockById = new Map(variants.map((v) => [v.id, v.stock]));
          const labelById = new Map(variants.map((v) => [v.id, v.label]));
          // Units already committed by OTHER non-rejected orders (this order is
          // still 'rejected' here, so it's naturally excluded from the sum).
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
          const wantByVariant = new Map<string, number>();
          for (const it of items) {
            if (!it.variantId) continue;
            wantByVariant.set(it.variantId, (wantByVariant.get(it.variantId) ?? 0) + it.quantity);
          }
          for (const [vid, want] of wantByVariant) {
            const stock = stockById.get(vid);
            if (stock == null) continue; // untracked stock = unlimited
            const sold = soldByVariant.get(vid) ?? 0;
            if (sold + want > stock) {
              throw new RevertConflict(
                `Cannot revert: only ${Math.max(0, stock - sold)} left for "${labelById.get(vid) ?? "an item"}", but this order needs ${want}.`
              );
            }
          }
        }
      }

      await tx
        .update(shopOrders)
        .set({
          status: newStatus,
          // Reverting clears the review trail so the order looks freshly pending.
          reviewedBy: isRevert ? null : actorId,
          reviewedAt: isRevert ? null : new Date(),
          rejectionReason: action === "reject" ? rejectionReason ?? null : null,
          updatedAt: new Date(),
        })
        .where(eq(shopOrders.id, id));

      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        targetId: id,
        action: `${LABEL_BY_ACTION[action]} shop order ${id}`,
        ipAddress: ipAddress,
      });
    });
  }

  /**
   * Corrects an order's details (option swap, quantity, personalization, note,
   * delivery details) under row locks, re-validating stock and recomputing
   * totals, with its audit log, in one transaction. Throws EditValidation,
   * EditConflict or SellerInactive.
   */
  static async editOrder(params: {
    id: string;
    data: OrderEditInput;
    actorId: string;
    ipAddress: string;
  }) {
    const { id, data, actorId, ipAddress } = params;
    await db.transaction(async (tx) => {
      // Lock the order + seller status for the whole edit (mirrors the review
      // transaction), so a suspension — or a second concurrent edit — can't
      // race an in-flight correction.
      const [lockedOrder] = await tx
        .select({ sellerId: shopOrders.sellerId, status: shopOrders.status, fulfillment: shopOrders.fulfillment, shippingFee: shopOrders.shippingFee, discountAmount: shopOrders.discountAmount })
        .from(shopOrders)
        .where(eq(shopOrders.id, id))
        .limit(1)
        .for("update");
      if (!lockedOrder) throw new EditValidation("Not found");
      if (lockedOrder.sellerId) {
        const [seller] = await tx
          .select({ status: shopSellers.status })
          .from(shopSellers)
          .where(eq(shopSellers.id, lockedOrder.sellerId))
          .limit(1)
          .for("share");
        if (seller?.status !== "approved") throw new SellerInactive();
      }

      // Re-read the items under the lock just taken above — NOT the pre-check
      // copy from before the transaction — so a concurrent edit/purchase can't
      // make this transaction compute totals/stock from stale data.
      const existingItems = await tx
        .select({
          id: shopOrderItems.id,
          productId: shopOrderItems.productId,
          variantId: shopOrderItems.variantId,
          variantLabel: shopOrderItems.variantLabel,
          customValues: shopOrderItems.customValues,
          quantity: shopOrderItems.quantity,
          unitPrice: shopOrderItems.unitPrice,
          handedOverAt: shopOrderItems.handedOverAt,
        })
        .from(shopOrderItems)
        .where(eq(shopOrderItems.orderId, id))
        .for("update");
      const editByItemId = new Map(data.items.map((e) => [e.id, e]));
      for (const edit of data.items) {
        const cur = existingItems.find((i) => i.id === edit.id);
        if (!cur) throw new EditValidation("One of the order items was not found.");
        if (!cur.productId) throw new EditValidation("This line's product no longer exists, so its option can't be edited.");
      }

      if (lockedOrder.fulfillment === "delivery") {
        for (const [field, value] of [
          ["recipientName", data.recipientName],
          ["recipientPhone", data.recipientPhone],
          ["shippingAddress", data.shippingAddress],
        ] as const) {
          if (value !== undefined && value.trim() === "") {
            throw new EditValidation(`"${field}" can't be left blank on a delivery order.`);
          }
        }
      }

      const variantIds = [...new Set(data.items.map((e) => e.variantId))];
      const variants = variantIds.length
        ? await tx.select().from(shopVariants).where(inArray(shopVariants.id, variantIds)).for("update")
        : [];
      const variantById = new Map(variants.map((v) => [v.id, v]));

      const productIds = [...new Set(variants.map((v) => v.productId))];
      const products = productIds.length
        ? await tx.select().from(shopProducts).where(inArray(shopProducts.id, productIds))
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      // A swap must stay within the same product as the item being edited.
      for (const edit of data.items) {
        const cur = existingItems.find((i) => i.id === edit.id)!;
        const variant = variantById.get(edit.variantId);
        if (!variant || variant.productId !== cur.productId) {
          throw new EditValidation("The new option must belong to the same product.");
        }
      }

      // Re-validate stock for every distinct target variant, the same way a
      // revert does: units already committed by OTHER orders (or other items
      // within this order) must not exceed the variant's cap. Rejected orders
      // don't count toward stock at all, so skip the check entirely for one.
      if (lockedOrder.status !== "rejected" && variantIds.length) {
        const soldRows = await tx
          .select({
            variantId: shopOrderItems.variantId,
            sold: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)`,
          })
          .from(shopOrderItems)
          .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
          .where(and(inArray(shopOrderItems.variantId, variantIds), ne(shopOrders.status, "rejected"), ne(shopOrderItems.orderId, id)))
          .groupBy(shopOrderItems.variantId);
        const soldByVariant = new Map(soldRows.map((r) => [r.variantId, Number(r.sold)]));

        const wantByVariant = new Map<string, number>();
        for (const item of existingItems) {
          const edit = editByItemId.get(item.id);
          const targetVariantId = edit ? edit.variantId : item.variantId;
          const targetQty = edit ? edit.quantity : item.quantity;
          if (!targetVariantId) continue;
          wantByVariant.set(targetVariantId, (wantByVariant.get(targetVariantId) ?? 0) + targetQty);
        }
        for (const vid of variantIds) {
          const variant = variantById.get(vid)!;
          if (variant.stock == null) continue;
          const sold = soldByVariant.get(vid) ?? 0;
          const want = wantByVariant.get(vid) ?? 0;
          if (sold + want > variant.stock) {
            throw new EditConflict(
              `Cannot switch to "${variant.label}": only ${Math.max(0, variant.stock - sold)} left, but this order needs ${want}.`
            );
          }
        }
      }

      const customValuesEqual = (a: { label: string; value: string }[] | null, b: { label: string; value: string }[] | null) => {
        const av = a ?? [];
        const bv = b ?? [];
        return av.length === bv.length && av.every((x, i) => x.label === bv[i]?.label && x.value === bv[i]?.value);
      };

      // A per-product delivery fee can be quantity-tiered, so a quantity edit
      // can change what's owed for shipping — but ONLY recompute it when a
      // quantity actually changed. Otherwise, if the product's delivery
      // config has since drifted, an edit that never touched quantity (e.g.
      // just fixing the note) would silently move a historically-snapshotted
      // shippingFee, the same snapshot-fidelity concern as unitPrice above.
      // The bundle-promotion discount follows the same rule, but since a deal can
      // be scoped to specific options, swapping an option (e.g. embroidered →
      // screen print) can also change it. So it's recomputed (off the live
      // product's deals) when a quantity OR an option changed, never otherwise.
      let shippingFee = lockedOrder.shippingFee;
      let discountAmount = lockedOrder.discountAmount;
      const anyQuantityChanged = existingItems.some((item) => {
        const edit = editByItemId.get(item.id);
        return edit && edit.quantity !== item.quantity;
      });
      const anyOptionChanged = existingItems.some((item) => {
        const edit = editByItemId.get(item.id);
        return edit && edit.variantId !== item.variantId;
      });
      const qtyByProduct = new Map<string, number>();
      if (anyQuantityChanged || anyOptionChanged) {
        const qtyByVariant = new Map<string, number>();
        for (const item of existingItems) {
          if (!item.productId) continue;
          const edit = editByItemId.get(item.id);
          const qty = edit ? edit.quantity : item.quantity;
          qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + qty);
          const targetVariantId = edit ? edit.variantId : item.variantId;
          if (targetVariantId) qtyByVariant.set(targetVariantId, (qtyByVariant.get(targetVariantId) ?? 0) + qty);
        }
        const missingProductIds = [...qtyByProduct.keys()].filter((pid) => !productById.has(pid));
        if (missingProductIds.length) {
          const extraProducts = await tx.select().from(shopProducts).where(inArray(shopProducts.id, missingProductIds));
          for (const p of extraProducts) productById.set(p.id, p);
        }

        // A deal's reference price is its cheapest eligible option, so pass ALL of
        // each product's options, not just the ones on this order.
        const productVariants = qtyByProduct.size
          ? await tx
              .select({ id: shopVariants.id, productId: shopVariants.productId, priceDelta: shopVariants.priceDelta })
              .from(shopVariants)
              .where(inArray(shopVariants.productId, [...qtyByProduct.keys()]))
          : [];
        discountAmount = 0;
        for (const pid of qtyByProduct.keys()) {
          const product = productById.get(pid);
          if (!product) continue; // product since deleted — no deal config left to apply
          discountAmount += computeBundleDiscount(product, productVariants.filter((v) => v.productId === pid), qtyByVariant);
        }
      }
      if (anyQuantityChanged && lockedOrder.fulfillment === "delivery") {
        let fallbackFee = 0;
        if (lockedOrder.sellerId) {
          const [seller] = await tx.select({ deliveryFee: shopSellers.deliveryFee }).from(shopSellers).where(eq(shopSellers.id, lockedOrder.sellerId)).limit(1);
          fallbackFee = seller?.deliveryFee ?? 0;
        } else {
          const [settings] = await tx.select({ deliveryFee: shopSettings.deliveryFee }).from(shopSettings).orderBy(desc(shopSettings.updatedAt)).limit(1);
          fallbackFee = settings?.deliveryFee ?? 0;
        }

        shippingFee = 0;
        for (const [pid, qty] of qtyByProduct) {
          const product = productById.get(pid);
          if (!product) continue; // product since deleted — can't recompute its share, leave uncharged
          shippingFee += computeProductDeliveryFee(product, qty, fallbackFee);
        }
      }

      let newTotal = shippingFee - discountAmount;
      for (const item of existingItems) {
        const edit = editByItemId.get(item.id);
        if (!edit) {
          newTotal += item.unitPrice * item.quantity;
          continue;
        }
        const variant = variantById.get(edit.variantId)!;
        const product = productById.get(variant.productId)!;

        let variantLabel = variant.label;
        if (variant.allowCustom) {
          const custom = (edit.customValue ?? "").trim();
          if (!custom) throw new EditValidation(`Please specify a value for "${variant.label}" on ${product.name}.`);
          variantLabel = `${variant.label}: ${custom}`;
        }

        const customResult = validateCustomAnswers(product.customFields, edit.custom, product.name);
        if (!customResult.ok) throw new EditValidation(customResult.error);
        const newCustomValues = customResult.snapshot.length ? customResult.snapshot : null;

        // Only re-price off the LIVE product price when the option/answers
        // genuinely changed. Otherwise an admin who opens this just to fix the
        // quantity or the delivery address would silently reprice every
        // untouched line to today's product price if it moved since the buyer
        // paid — the snapshot posture (see productName/variantLabel comments
        // in schema.ts) is "what was actually bought", not "what it costs
        // today". A pure quantity change keeps the line's historical unitPrice
        // and only moves the extended total.
        const optionChanged = edit.variantId !== item.variantId
          || variantLabel !== item.variantLabel
          || !customValuesEqual(item.customValues, newCustomValues);
        const quantityChanged = edit.quantity !== item.quantity;

        if (!optionChanged && !quantityChanged) {
          newTotal += item.unitPrice * item.quantity;
          continue;
        }
        // The buyer already has this line in hand — the record must keep saying
        // what they actually got. Undo the handover first to correct it.
        if (item.handedOverAt) {
          throw new EditValidation(`${product.name} was already handed over, so it can't be changed. Undo the handover first.`);
        }

        const unitPrice = optionChanged ? product.price + (variant.priceDelta ?? 0) : item.unitPrice;
        newTotal += unitPrice * edit.quantity;

        await tx
          .update(shopOrderItems)
          .set({
            variantId: variant.id,
            variantLabel,
            customValues: newCustomValues,
            unitPrice,
            quantity: edit.quantity,
          })
          .where(eq(shopOrderItems.id, item.id));
      }

      const orderPatch: Partial<typeof shopOrders.$inferInsert> = { totalAmount: newTotal, shippingFee, discountAmount, updatedAt: new Date() };
      if (data.note !== undefined) orderPatch.note = data.note.trim() || null;
      if (lockedOrder.fulfillment === "delivery") {
        if (data.recipientName !== undefined) orderPatch.recipientName = data.recipientName.trim();
        if (data.recipientPhone !== undefined) orderPatch.recipientPhone = data.recipientPhone.trim();
        if (data.shippingAddress !== undefined) orderPatch.shippingAddress = data.shippingAddress.trim();
      }
      await tx.update(shopOrders).set(orderPatch).where(eq(shopOrders.id, id));

      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        targetId: id,
        action: `Edited shop order ${id} (corrected option/quantity/personalization/delivery details)`,
        ipAddress: ipAddress,
      });
    });
  }
}
