import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrders, shopOrderItems, shopVariants } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop-scope";
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

    const [order] = await db.select({ id: shopOrders.id, status: shopOrders.status }).from(shopOrders).where(eq(shopOrders.id, id)).limit(1);
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // A scoped president may review an order only when EVERY line item is for a
    // product their club/major owns — approve/reject/revert is order-wide (stock,
    // status), so a mixed-club order stays super_admin/admin only.
    if (!access.unscoped) {
      const info = (await classifyOrdersByScope([id], access.scope)).get(id);
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
