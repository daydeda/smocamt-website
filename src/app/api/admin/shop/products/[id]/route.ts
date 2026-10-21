import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { isOwnerAssignmentWithinScope, isProductOwnedByScope, isShopAdmin, isShopFullAdmin } from "@/lib/shop/shop-auth";
import { resolveShopAccess } from "@/lib/shop/shop-scope";
import { ShopAdminService } from "@/modules/shop/shop-admin.service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { productSchema } from "@/lib/shop/shop-product-schema";
import { resolveBundleDeals } from "@/lib/shop/shop-promotions";
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
      const current = await ShopAdminService.getProductForEdit(id);
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

    await ShopAdminService.updateProduct({
      id,
      data,
      variantIds,
      bundleDeals: bundle.deals,
      sellerScope: access.unscoped ? null : { sellerId: scopedSellerId },
      needsReReview,
      actorId: access.userId,
      ipAddress: getClientIp(req),
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

    const product = await ShopAdminService.getProductWithOwnership(id);
    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // A scoped president may only delete a product their club/major owns.
    if (!access.unscoped && !isProductOwnedByScope(product, access.scope, access.sellerId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await ShopAdminService.deleteProduct(id, product.name, access.userId, getClientIp(req));

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

    const result = await ShopAdminService.reviewProduct(id, data, isShopFullAdmin(session), session!.user!.id!, getClientIp(req));

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
