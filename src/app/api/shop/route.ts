import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrderItems, shopOrders, shopProducts, shopSellers, shopSettings, shopVariants, users } from "@/db/schema";
import { buildViewer, isEligibleFor } from "@/lib/event-access";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/shop — the storefront for logged-in buyers: active products (with their
// variants + remaining stock) and the payment settings (QR + instructions).
// Returns { enabled, paymentInfo, qrImageUrl, products: [...] }.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [settings] = await db
      .select()
      .from(shopSettings)
      .orderBy(desc(shopSettings.updatedAt))
      .limit(1);

    // Shop turned off — hide everything but report the flag so the UI can explain.
    if (!settings || !settings.enabled) {
      return NextResponse.json({ enabled: false, paymentInfo: "", qrImageUrl: null, deliveryEnabled: false, deliveryFee: 0, pickupInfo: "", products: [] });
    }

    // Major lives on the users row (not on the session token); needed for the
    // major-based visibility check. Roles + studentId come from the session.
    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id!),
      columns: { major: true },
    });
    const viewer = buildViewer({
      roles: session.user.roles || [session.user.role || "student"],
      studentId: session.user.studentId,
      major: me?.major,
    });

    const activeProducts = await db
      .select()
      .from(shopProducts)
      .where(and(eq(shopProducts.isActive, true), eq(shopProducts.approvalStatus, "approved")))
      .orderBy(asc(shopProducts.sortOrder), desc(shopProducts.createdAt));

    const sellerIds = [...new Set(activeProducts.map((p) => p.sellerId).filter((id): id is string => !!id))];
    const approvedSellers = sellerIds.length
      ? await db
          .select({
            id: shopSellers.id,
            displayName: shopSellers.displayName,
            paymentInfo: shopSellers.paymentInfo,
            qrImageUrl: shopSellers.qrImageUrl,
            deliveryEnabled: shopSellers.deliveryEnabled,
            deliveryFee: shopSellers.deliveryFee,
            pickupInfo: shopSellers.pickupInfo,
          })
          .from(shopSellers)
          .where(and(inArray(shopSellers.id, sellerIds), eq(shopSellers.status, "approved")))
      : [];
    const sellerById = new Map(approvedSellers.map((seller) => [seller.id, seller]));

    // Hide products this buyer isn't in the audience for (role / major / Thai-intl).
    // Admin-role viewers get the predicate's built-in bypass (they see everything).
    const products = activeProducts.filter((p) =>
      isEligibleFor(p, viewer) && (!p.sellerId || sellerById.has(p.sellerId))
    );

    const productIds = products.map((p) => p.id);
    const variants = productIds.length
      ? await db
          .select()
          .from(shopVariants)
          .where(inArray(shopVariants.productId, productIds))
          .orderBy(asc(shopVariants.sortOrder))
      : [];

    // Units already committed per variant (everything not rejected counts against
    // stock). One grouped query instead of N.
    const variantIds = variants.map((v) => v.id);
    const soldRows = variantIds.length
      ? await db
          .select({
            variantId: shopOrderItems.variantId,
            sold: sql<number>`coalesce(sum(${shopOrderItems.quantity}), 0)`,
          })
          .from(shopOrderItems)
          .innerJoin(shopOrders, eq(shopOrderItems.orderId, shopOrders.id))
          .where(and(inArray(shopOrderItems.variantId, variantIds), ne(shopOrders.status, "rejected")))
          .groupBy(shopOrderItems.variantId)
      : [];
    const soldByVariant = new Map(soldRows.map((r) => [r.variantId, Number(r.sold)]));

    const now = new Date();
    const result = products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      imageUrls: p.imageUrls ?? (p.imageUrl ? [p.imageUrl] : []),
      maxPerOrder: p.maxPerOrder,
      opensAt: p.opensAt,
      closesAt: p.closesAt,
      // 'upcoming' (before opensAt) | 'closed' (after closesAt) | 'open'
      saleStatus: p.opensAt && now < p.opensAt ? "upcoming" : p.closesAt && now > p.closesAt ? "closed" : "open",
      customFields: p.customFields ?? [],
      // Per-product delivery pricing (null fee = falls back to shop-wide deliveryFee).
      deliveryFee: p.deliveryFee ?? null,
      deliveryTiers: p.deliveryTiers ?? [],
      seller: p.sellerId ? sellerById.get(p.sellerId) ?? null : null,
      variants: variants
        .filter((v) => v.productId === p.id)
        .map((v) => ({
          id: v.id,
          label: v.label,
          allowCustom: v.allowCustom,
          // Surcharge (฿) added on top of the product price for this variant. The
          // buyer UI must add it to the unit price; the server recomputes anyway.
          priceDelta: v.priceDelta ?? 0,
          // null stock = unlimited; otherwise remaining after committed units.
          remaining: v.stock == null ? null : Math.max(0, v.stock - (soldByVariant.get(v.id) ?? 0)),
        })),
    }));

    return NextResponse.json({
      enabled: true,
      paymentInfo: settings.paymentInfo,
      qrImageUrl: settings.qrImageUrl,
      deliveryEnabled: settings.deliveryEnabled,
      deliveryFee: settings.deliveryFee,
      pickupInfo: settings.pickupInfo,
      products: result,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
