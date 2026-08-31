import { auth } from "@/auth";
import { db } from "@/db";
import { clubs, shopOrderItems, shopOrders, shopProducts, shopVariants } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { filterProductsByScope, isOwnerAssignmentWithinScope } from "@/lib/shop-auth";
import { resolveShopAccess } from "@/lib/shop-scope";
import { FACULTIES } from "@/lib/faculties";
import { productSchema } from "@/lib/shop-product-schema";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ALL_MAJORS = FACULTIES.flatMap((f) => f.majors);

// GET /api/admin/shop/products — products (incl. inactive) with their variants
// and committed (non-rejected) sold counts, for the admin product manager.
// super_admin/admin get every product; club_president/major_president get only
// the ones their club/major owns (shop_products.ownerClubIds / ownerMajors).
// Returns { products, scoped, ownerOptions } — ownerOptions feeds the form's
// club/major owner pickers (all clubs+majors for an admin, just the caller's
// own for a president).
export async function GET() {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allProducts = await db
      .select()
      .from(shopProducts)
      .orderBy(asc(shopProducts.sortOrder), desc(shopProducts.createdAt));

    const products = access.unscoped ? allProducts : filterProductsByScope(allProducts, access.scope);

    const productIds = products.map((p) => p.id);
    const variants = productIds.length
      ? await db.select().from(shopVariants).where(inArray(shopVariants.productId, productIds)).orderBy(asc(shopVariants.sortOrder))
      : [];

    const variantIds = variants.map((v) => v.id);
    const soldRows = variantIds.length
      ? await db
          .select({ variantId: shopOrderItems.variantId, sold: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)` })
          .from(shopOrderItems)
          .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
          .where(and(inArray(shopOrderItems.variantId, variantIds), ne(shopOrders.status, "rejected")))
          .groupBy(shopOrderItems.variantId)
      : [];
    const soldByVariant = new Map(soldRows.map((r) => [r.variantId, Number(r.sold)]));

    // Owner-picker options. A president can only ever assign their own club(s)/
    // major, so scope the list to that; an admin picks from all active clubs +
    // every major (or leaves it blank for a central product).
    const activeClubs = await db
      .select({ id: clubs.id, name: clubs.name })
      .from(clubs)
      .where(eq(clubs.isArchived, false))
      .orderBy(asc(clubs.name));
    const ownerOptions = access.unscoped
      ? { clubs: activeClubs, majors: ALL_MAJORS }
      : {
          clubs: activeClubs.filter((c) => access.scope.clubIds.includes(c.id)),
          majors: ALL_MAJORS.filter((m) => access.scope.majors.includes(m)),
        };

    const result = products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      imageUrls: p.imageUrls ?? (p.imageUrl ? [p.imageUrl] : []),
      maxPerOrder: p.maxPerOrder,
      opensAt: p.opensAt,
      closesAt: p.closesAt,
      isActive: p.isActive,
      allowedRoles: p.allowedRoles ?? [],
      allowedMajors: p.allowedMajors ?? [],
      targetThai: p.targetThai ?? true,
      targetInternational: p.targetInternational ?? true,
      customFields: p.customFields ?? [],
      deliveryFee: p.deliveryFee ?? null,
      deliveryTiers: p.deliveryTiers ?? [],
      sortOrder: p.sortOrder,
      ownerClubIds: p.ownerClubIds ?? [],
      ownerMajors: p.ownerMajors ?? [],
      variants: variants
        .filter((v) => v.productId === p.id)
        .map((v) => ({ id: v.id, label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta ?? 0, sold: soldByVariant.get(v.id) ?? 0 })),
    }));

    return NextResponse.json({ products: result, scoped: !access.unscoped, ownerOptions });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/shop/products — create a product and its variants. A scoped
// president must assign an owner within their own club(s)/major; an admin may
// leave it blank (central product).
export async function POST(req: Request) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const data = productSchema.parse(await req.json());

    if (!access.unscoped && !isOwnerAssignmentWithinScope(data.ownerClubIds, data.ownerMajors, access.scope)) {
      return NextResponse.json(
        { error: "You can only create products owned by a club or major you preside over." },
        { status: 403 }
      );
    }

    const productId = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(shopProducts)
        .values({
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
          sortOrder: data.sortOrder,
          ownerClubIds: data.ownerClubIds,
          ownerMajors: data.ownerMajors,
        })
        .returning({ id: shopProducts.id });

      await tx.insert(shopVariants).values(
        data.variants.map((v, i) => ({ productId: product.id, label: v.label, stock: v.stock, allowCustom: v.allowCustom, priceDelta: v.priceDelta, sortOrder: i }))
      );

      const ownerNote = data.ownerClubIds.length || data.ownerMajors.length
        ? ` (owner clubs: [${data.ownerClubIds.join(", ")}], majors: [${data.ownerMajors.join(", ")}])`
        : " (central)";
      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        action: `Created shop product "${data.name}"${ownerNote}`,
        ipAddress: getClientIp(req),
      });

      return product.id;
    });

    return NextResponse.json({ success: true, id: productId }, { status: 201 });
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
