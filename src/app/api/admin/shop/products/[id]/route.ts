import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopProducts, shopVariants } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { isOwnerAssignmentWithinScope, isProductOwnedByScope, isShopAdmin, isShopFullAdmin } from "@/lib/shop-auth";
import { resolveShopAccess } from "@/lib/shop-scope";
import { and, eq, notInArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { productSchema } from "@/lib/shop-product-schema";
import { resolveBundleDeals } from "@/lib/shop-promotions";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const approvalSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

// PUT /api/admin/shop/products/[id] — update a product and reconcile its variants:
// variants with an id are updated, new ones inserted, and any existing variant not
// in the payload is deleted (order_items keep their snapshot via ON DELETE SET NULL).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = productSchema.parse(await req.json());

    // A scoped president may only touch a product their club/major owns, and may
    // not re-assign it outside their scope (or make it central).
    let scopedSellerId: string | null = null;
    let needsReReview = false;
    if (!access.unscoped) {
      if (!access.sellerId) {
        return NextResponse.json(
          { error: "Seller approval is required before managing products." },
          { status: 403 },
        );
      }
      const [current] = await db
        .select({
          sellerId: shopProducts.sellerId,
          ownerClubIds: shopProducts.ownerClubIds,
          ownerMajors: shopProducts.ownerMajors,
          approvalStatus: shopProducts.approvalStatus,
        })
        .from(shopProducts)
        .where(eq(shopProducts.id, id))
        .limit(1);
      if (!current || !isProductOwnedByScope(current, access.scope, access.sellerId)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const hasPresidentScope = access.scope.clubIds.length > 0 || access.scope.majors.length > 0;
      if (hasPresidentScope && !isOwnerAssignmentWithinScope(data.ownerClubIds, data.ownerMajors, access.scope)) {
        return NextResponse.json(
          { error: "You can only assign this product to a club or major you preside over." },
          { status: 403 }
        );
      }
      if (!hasPresidentScope && (data.ownerClubIds.length > 0 || data.ownerMajors.length > 0)) {
        return NextResponse.json({ error: "You cannot assign an organization owner." }, { status: 403 });
      }
      // The first approved seller to edit a legacy organization-owned product
      // claims its payout identity. A product already attached to another seller
      // was rejected by isProductOwnedByScope above.
      scopedSellerId = current.sellerId ?? access.sellerId;
      // A scoped seller/president edit re-opens review: an already-approved
      // listing could otherwise be swapped for different content post-approval
      // without another look from an unscoped reviewer.
      needsReReview = current.approvalStatus !== "pending";
    }

    // Existing options keep their id; new ones get one assigned here so promotions
    // scoped to specific options (sent as indexes into data.variants) can be resolved.
    const variantIds = data.variants.map((v) => v.id ?? randomUUID());
    const bundle = resolveBundleDeals(data.bundleDeals, variantIds);
    if (!bundle.ok) {
      return NextResponse.json({ error: bundle.error }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: shopProducts.id, name: shopProducts.name }).from(shopProducts).where(eq(shopProducts.id, id)).limit(1);
      if (!existing) throw new z.ZodError([{ code: "custom", message: "Product not found", path: ["id"] }]);
      // Snapshot current variant labels before the upsert loop below overwrites
      // them, so a rename can be propagated to existing order lines afterward.
      const priorVariants = await tx.select({ id: shopVariants.id, label: shopVariants.label }).from(shopVariants).where(eq(shopVariants.productId, id));
      const priorLabelById = new Map(priorVariants.map((v) => [v.id, v.label]));

      await tx
        .update(shopProducts)
        .set({
          name: data.name,
          description: data.description,
          price: data.price,
          imageUrl: data.imageUrls[0] ?? null,
          imageUrls: data.imageUrls,
          maxPerOrder: data.maxPerOrder,
          opensAt: data.opensAt,
          closesAt: data.closesAt,
          isActive: data.isActive,
          allowedRoles: data.allowedRoles,
          allowedMajors: data.allowedMajors,
          targetThai: data.targetThai,
          targetInternational: data.targetInternational,
          customFields: data.customFields,
          deliveryFee: data.deliveryFee,
          deliveryTiers: data.deliveryTiers,
          bundleDeals: bundle.deals,
          sortOrder: data.sortOrder,
          ownerClubIds: data.ownerClubIds,
          ownerMajors: data.ownerMajors,
          ...(!access.unscoped ? { sellerId: scopedSellerId } : {}),
          ...(needsReReview
            ? { approvalStatus: "pending", approvalReason: null, reviewedBy: null, reviewedAt: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(shopProducts.id, id));

      // Order lines snapshot productName/variantLabel at checkout so past orders
      // read as what was actually bought — but a rename (fixing a typo, or just
      // renaming "Pre-order" -> "Pre-order2") otherwise splits an order's history
      // across two names in every admin list/filter/export that groups by them.
      // Propagate a rename to EVERY existing order line for this product
      // (regardless of status), so they stay one consistent group.
      if (existing.name !== data.name) {
        await tx.update(shopOrderItems).set({ productName: data.name }).where(eq(shopOrderItems.productId, id));
      }

      const keepIds = data.variants.map((v) => v.id).filter((v): v is string => Boolean(v));
      // Delete variants the admin removed.
      if (keepIds.length) {
        await tx.delete(shopVariants).where(and(eq(shopVariants.productId, id), notInArray(shopVariants.id, keepIds)));
      } else {
        await tx.delete(shopVariants).where(eq(shopVariants.productId, id));
      }

      // Upsert each variant in order (sortOrder = position).
      for (let i = 0; i < data.variants.length; i++) {
        const v = data.variants[i];
        if (v.id) {
          await tx
            .update(shopVariants)
            .set({ label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta, sortOrder: i })
            .where(and(eq(shopVariants.id, v.id), eq(shopVariants.productId, id)));

          // Same propagation as the product name, for the variant label. A line's
          // snapshot is either the bare label ("M") or, for an "Other (specify)"
          // option, "M: <what the buyer typed>" — only replace the label PREFIX so
          // the buyer's typed text survives. Matched with exact string ops
          // (left()/char_length()), never LIKE, so a label containing a literal
          // "%" or "_" (both SQL wildcards) can't widen the match; char_length()
          // (not JS .length) keeps the cut point correct for multi-byte text.
          // Guarded so a rename from "S" doesn't accidentally match a line
          // snapshotted as "Small".
          const priorLabel = priorLabelById.get(v.id);
          if (priorLabel != null && priorLabel !== v.label) {
            const prefixWithColon = `${priorLabel}: `;
            await tx
              .update(shopOrderItems)
              .set({ variantLabel: sql`${v.label} || substring(${shopOrderItems.variantLabel} from char_length(${priorLabel}) + 1)` })
              .where(
                and(
                  eq(shopOrderItems.variantId, v.id),
                  or(
                    eq(shopOrderItems.variantLabel, priorLabel),
                    sql`left(${shopOrderItems.variantLabel}, char_length(${prefixWithColon})) = ${prefixWithColon}`
                  )
                )
              );
          }
        } else {
          await tx.insert(shopVariants).values({ id: variantIds[i], productId: id, label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta, sortOrder: i });
        }
      }

      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        action: `Updated shop product "${data.name}" (owner clubs: [${data.ownerClubIds.join(", ")}], majors: [${data.ownerMajors.join(", ")}])`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
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

// DELETE /api/admin/shop/products/[id] — remove a product. Existing order line
// items keep their snapshot (ON DELETE SET NULL on product_id/variant_id), so
// order history stays intact. Prefer toggling isActive=false to hide a product
// while keeping it; delete is for mistakes. SMO Finance sees every product but
// may not delete one — only super_admin/admin (or a scoped owner, their own).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (access.unscoped && !access.fullAdmin) {
      return NextResponse.json({ error: "Only an admin can delete products." }, { status: 403 });
    }
    const { id } = await params;

    const [product] = await db
      .select({ name: shopProducts.name, sellerId: shopProducts.sellerId, ownerClubIds: shopProducts.ownerClubIds, ownerMajors: shopProducts.ownerMajors })
      .from(shopProducts)
      .where(eq(shopProducts.id, id))
      .limit(1);
    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // A scoped president may only delete a product their club/major owns.
    if (!access.unscoped && !isProductOwnedByScope(product, access.scope, access.sellerId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx.delete(shopProducts).where(eq(shopProducts.id, id));
      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        action: `Deleted shop product "${product.name}"`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH /api/admin/shop/products/[id] — trusted reviewer approval for a
// pending product. Scoped sellers/presidents cannot self-approve. A seller
// product may be reviewed by any unscoped reviewer (incl. SMO Finance); a
// central product (no seller — created pending by SMO Finance) only by
// super_admin/admin, so Finance can never approve its own listing.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!isShopAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = approvalSchema.parse(await req.json());
    if (data.action === "reject" && !data.reason) {
      return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: shopProducts.id, name: shopProducts.name, sellerId: shopProducts.sellerId })
        .from(shopProducts)
        .where(eq(shopProducts.id, id))
        .limit(1);
      if (!product) return { notFound: true as const };
      if (!product.sellerId && !isShopFullAdmin(session)) return { central: true as const };

      const status = data.action === "approve" ? "approved" : "rejected";
      await tx
        .update(shopProducts)
        .set({
          approvalStatus: status,
          approvalReason: data.action === "reject" ? data.reason : null,
          reviewedBy: session!.user!.id!,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shopProducts.id, id));

      await AuditService.logActionInternal(tx, {
        actorId: session!.user!.id!,
        targetId: id,
        action: `${data.action === "approve" ? "Approved" : "Rejected"} ${product.sellerId ? "seller" : "central"} product "${product.name}" (${id})`,
        ipAddress: getClientIp(req),
      });
      return { status };
    });

    if ("notFound" in result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ("central" in result) return NextResponse.json({ error: "Only an admin can approve a central product." }, { status: 403 });
    return NextResponse.json({ success: true, status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 },
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
