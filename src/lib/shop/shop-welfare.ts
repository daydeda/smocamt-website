// Welfare pricing (สวัสดิการ). An admin sets, per product, an at-cost base price
// (shop_products.welfarePrice) and the roles that get it (welfareRoles, e.g.
// ["smo"]). A buyer holding any of those roles is charged the welfare price in
// place of `price`. Variant surcharges still add on top, and bundle deals are
// computed off the welfare base, so a qualifying buyer never pays more than the
// normal buyer would for the same order.
//
// Who sees it: the storefront sends welfarePrice ONLY to a qualifying buyer, so
// it never reaches anyone else's browser. Reused by:
//   - GET /api/shop (whether to include welfarePrice),
//   - POST /api/shop/orders (authoritative unit price + bundle discount),
//   - the admin order edit (a re-priced line keeps the welfare price), and
//   - the storefront (ShopClient) for the live estimate.

export interface WelfareProduct {
  price: number;
  welfarePrice?: number | null;
  welfareRoles?: readonly string[] | null;
}

/** Does this buyer hold a role the product's welfare is for? */
export function qualifiesForWelfare(
  product: Pick<WelfareProduct, "welfareRoles">,
  buyerRoles: readonly string[] | null | undefined,
): boolean {
  const welfareRoles = product.welfareRoles ?? [];
  return welfareRoles.length > 0 && (buyerRoles ?? []).some((r) => welfareRoles.includes(r));
}

/** A product has a usable welfare price: set, below the normal price, and roles chosen. */
export function hasWelfarePrice(product: WelfareProduct): boolean {
  return product.welfarePrice != null
    && product.welfarePrice < product.price
    && (product.welfareRoles?.length ?? 0) > 0;
}

/**
 * The product as this buyer is charged for it: `price` swapped for the welfare
 * price when the buyer qualifies and the product has a usable welfare price.
 * Welfare can only ever lower the price, never raise it.
 */
export function applyWelfare<T extends WelfareProduct>(product: T, buyerRoles: readonly string[] | null | undefined): T {
  if (!hasWelfarePrice(product) || !qualifiesForWelfare(product, buyerRoles)) return product;
  return { ...product, price: product.welfarePrice! };
}
