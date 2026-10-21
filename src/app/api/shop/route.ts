import { auth } from "@/auth";
import { buildViewer, isEligibleFor } from "@/lib/access/event-access";
import { effectiveUnitPrice, normalUnitPrice, qualifiesForWelfare } from "@/lib/shop/shop-welfare";
import { ShopService } from "@/modules/shop/shop.service";
import { UsersService } from "@/modules/users/users.service";
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

    const settings = await ShopService.getCurrentSettings();

    // Shop turned off — hide everything but report the flag so the UI can explain.
    if (!settings || !settings.enabled) {
      return NextResponse.json({ enabled: false, paymentInfo: "", qrImageUrl: null, deliveryEnabled: false, deliveryFee: 0, pickupInfo: "", products: [] });
    }

    // Major lives on the users row (not on the session token); needed for the
    // major-based visibility check. Roles + studentId come from the session.
    const me = await UsersService.getShopBuyerProfile(session.user.id!);
    const viewer = buildViewer({
      roles: session.user.roles || [session.user.role || "student"],
      studentId: session.user.studentId,
      major: me?.major,
    });
    // Welfare is decided off the DB roles (fresh), not the session token.
    const buyerRoles = me?.roles ?? [];

    const activeProducts = await ShopService.listActiveApprovedProducts();

    const sellerIds = [...new Set(activeProducts.map((p) => p.sellerId).filter((id): id is string => !!id))];
    const approvedSellers = sellerIds.length
      ? await ShopService.listApprovedSellersByIds(sellerIds)
      : [];
    const sellerById = new Map(approvedSellers.map((seller) => [seller.id, seller]));

    // Hide products this buyer isn't in the audience for (role / major / Thai-intl).
    // Admin-role viewers get the predicate's built-in bypass (they see everything).
    const products = activeProducts.filter((p) =>
      isEligibleFor(p, viewer) && (!p.sellerId || sellerById.has(p.sellerId))
    );

    const productIds = products.map((p) => p.id);
    const variants = productIds.length
      ? await ShopService.listVariantsForProducts(productIds)
      : [];

    // Units already committed per variant (everything not rejected counts against
    // stock). One grouped query instead of N.
    const variantIds = variants.map((v) => v.id);
    const soldRows = variantIds.length
      ? await ShopService.listSoldByVariant(variantIds)
      : [];
    const soldByVariant = new Map(soldRows.map((r) => [r.variantId, Number(r.sold)]));

    const now = new Date();
    const result = products.map((p) => {
      const productVariants = variants.filter((v) => v.productId === p.id);
      // The prices THIS buyer pays, option by option. For a qualifying buyer the
      // welfare prices are folded into price + priceDelta (price = their cheapest
      // option, each delta = its gap above that), so every client-side estimate and
      // the bundle math use the real figures without knowing about welfare.
      const normalPrices = productVariants.map((v) => normalUnitPrice(p, v));
      const payPrices = qualifiesForWelfare(p, buyerRoles)
        ? productVariants.map((v) => effectiveUnitPrice(p, v, buyerRoles))
        : normalPrices;
      const welfare = payPrices.some((pay, k) => pay < normalPrices[k]);
      const basePrice = welfare ? Math.min(...payPrices) : p.price;
      const deltaOf = (k: number) => (welfare ? payPrices[k] - basePrice : productVariants[k].priceDelta ?? 0);
      return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: basePrice,
      // Shown struck-through beside the welfare prices. Only present when it applies.
      ...(welfare ? { normalUnitPrices: normalPrices, welfare: true } : {}),
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
      // "Buy N for ฿X" promotions; the order route recomputes the discount anyway.
      bundleDeals: p.bundleDeals ?? [],
      seller: p.sellerId ? sellerById.get(p.sellerId) ?? null : null,
      variants: productVariants
        .map((v, k) => ({
          id: v.id,
          label: v.label,
          allowCustom: v.allowCustom,
          // Surcharge (฿) added on top of the product price for this variant. The
          // buyer UI must add it to the unit price; the server recomputes anyway.
          priceDelta: deltaOf(k),
          // null stock = unlimited; otherwise remaining after committed units.
          remaining: v.stock == null ? null : Math.max(0, v.stock - (soldByVariant.get(v.id) ?? 0)),
        })),
      };
    });

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
