import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrders, shopOrderItems, shopProducts, shopSellers, shopVariants } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop-scope";
import { validateCustomAnswers } from "@/lib/shop-custom-fields";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  // "revert" sends an already-reviewed order back to pending so it can be re-checked.
  action: z.enum(["approve", "reject", "revert"]),
  rejectionReason: z.string().max(500).optional(),
});

const STATUS_BY_ACTION = { approve: "approved", reject: "rejected", revert: "pending" } as const;
const LABEL_BY_ACTION = { approve: "Approved", reject: "Rejected", revert: "Reverted to pending" } as const;

// Thrown inside the PATCH transaction when a "revert" would oversell stock.
class RevertConflict extends Error {}
class SellerInactive extends Error {}
// Thrown inside the PUT (edit) transaction for a client-facing validation error.
class EditValidation extends Error {}
// Thrown inside the PUT (edit) transaction when a variant swap would oversell stock.
class EditConflict extends Error {}

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

    const [order] = await db
      .select({ id: shopOrders.id })
      .from(shopOrders)
      .where(eq(shopOrders.id, id))
      .limit(1);
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

    await db.transaction(async (tx) => {
      // Lock the order and seller status for the whole review transaction.
      // Seller approval/suspension takes FOR UPDATE on the same seller row, so
      // neither operation can race past the other's decision.
      const [lockedOrder] = await tx
        .select({ sellerId: shopOrders.sellerId })
        .from(shopOrders)
        .where(eq(shopOrders.id, id))
        .limit(1)
        .for("update");
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
          reviewedBy: isRevert ? null : access.userId,
          reviewedAt: isRevert ? null : new Date(),
          rejectionReason: data.action === "reject" ? data.rejectionReason ?? null : null,
          updatedAt: new Date(),
        })
        .where(eq(shopOrders.id, id));

      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        targetId: id,
        action: `${LABEL_BY_ACTION[data.action]} shop order ${id}`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    if (error instanceof SellerInactive) {
      return NextResponse.json({ error: "This seller is not active; order review is temporarily frozen." }, { status: 409 });
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
// details after the fact (e.g. a buyer forgot to pick the right size, or typo'd
// a jersey name). Editable at ANY status (pending/approved/rejected), because
// the whole point is fixing a mistake that's already been reviewed. Scoped to:
//   - per item: swap the VARIANT (must stay on the same product) + its
//     "Other (specify)" text / custom-field answers — never the product itself
//     or the quantity, to keep stock/shipping accounting simple and correct.
//   - order-level: note, and (delivery orders only) recipient name/phone/address.
// A variant swap is re-priced (unitPrice = product.price + variant.priceDelta)
// and re-validated against stock — same FOR UPDATE + oversell guard as revert.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = editSchema.parse(await req.json());

    const [order] = await db
      .select({ id: shopOrders.id })
      .from(shopOrders)
      .where(eq(shopOrders.id, id))
      .limit(1);
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
    const precheckItems = await db
      .select({ id: shopOrderItems.id, productId: shopOrderItems.productId })
      .from(shopOrderItems)
      .where(eq(shopOrderItems.orderId, id));
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

    await db.transaction(async (tx) => {
      // Lock the order + seller status for the whole edit (mirrors the review
      // transaction), so a suspension — or a second concurrent edit — can't
      // race an in-flight correction.
      const [lockedOrder] = await tx
        .select({ sellerId: shopOrders.sellerId, status: shopOrders.status, fulfillment: shopOrders.fulfillment, shippingFee: shopOrders.shippingFee })
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
          if (!targetVariantId) continue;
          wantByVariant.set(targetVariantId, (wantByVariant.get(targetVariantId) ?? 0) + item.quantity);
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

      let newTotal = lockedOrder.shippingFee;
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

        // Only actually touch (and re-price off the LIVE product price) a line
        // whose option/answers genuinely changed. Otherwise an admin who opens
        // this just to fix the note/delivery address would silently reprice
        // every untouched line to today's product price if it moved since the
        // buyer paid — the snapshot posture (see productName/variantLabel
        // comments in schema.ts) is "what was actually bought", not "what it
        // costs today".
        const unchanged = edit.variantId === item.variantId
          && variantLabel === item.variantLabel
          && customValuesEqual(item.customValues, newCustomValues);
        if (unchanged) {
          newTotal += item.unitPrice * item.quantity;
          continue;
        }

        const unitPrice = product.price + (variant.priceDelta ?? 0);
        newTotal += unitPrice * item.quantity;

        await tx
          .update(shopOrderItems)
          .set({
            variantId: variant.id,
            variantLabel,
            customValues: newCustomValues,
            unitPrice,
          })
          .where(eq(shopOrderItems.id, item.id));
      }

      const orderPatch: Partial<typeof shopOrders.$inferInsert> = { totalAmount: newTotal, updatedAt: new Date() };
      if (data.note !== undefined) orderPatch.note = data.note.trim() || null;
      if (lockedOrder.fulfillment === "delivery") {
        if (data.recipientName !== undefined) orderPatch.recipientName = data.recipientName.trim();
        if (data.recipientPhone !== undefined) orderPatch.recipientPhone = data.recipientPhone.trim();
        if (data.shippingAddress !== undefined) orderPatch.shippingAddress = data.shippingAddress.trim();
      }
      await tx.update(shopOrders).set(orderPatch).where(eq(shopOrders.id, id));

      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        targetId: id,
        action: `Edited shop order ${id} (corrected option/personalization/delivery details)`,
        ipAddress: getClientIp(req),
      });
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
