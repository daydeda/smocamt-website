// Welfare pricing (สวัสดิการ). An admin picks, per product, the roles that get
// welfare (welfareRoles, e.g. ["smo"]) and sets a welfare price on each option
// (shop_variants.welfarePrice, an absolute unit price: option 1 ฿39 → ฿29,
// option 2 ฿89 → ฿69). The product-level welfarePrice is a fallback base for
// options without their own price (welfarePrice + that option's surcharge).
// A buyer holding any chosen role is charged the welfare unit price. Welfare can
// only ever lower an option's price.
//
// Who sees it: the storefront sends welfare prices ONLY to a qualifying buyer, so
// they never reach anyone else's browser. Reused by:
//   - GET /api/shop (the buyer's effective prices),
//   - POST /api/shop/orders (authoritative unit price + bundle discount), and
//   - the admin order edit (a re-priced line keeps the welfare price).

export interface WelfareProduct {
  price: number;
  welfarePrice?: number | null;
  welfareRoles?: readonly string[] | null;
}

export interface WelfareVariant {
  priceDelta?: number | null;
  welfarePrice?: number | null;
}

/** Does this buyer hold a role the product's welfare is for? */
export function qualifiesForWelfare(
  product: Pick<WelfareProduct, "welfareRoles">,
  buyerRoles: readonly string[] | null | undefined,
): boolean {
  const welfareRoles = product.welfareRoles ?? [];
  return welfareRoles.length > 0 && (buyerRoles ?? []).some((r) => welfareRoles.includes(r));
}

/** The option's normal unit price: product price plus its surcharge. */
export function normalUnitPrice(product: Pick<WelfareProduct, "price">, variant: Pick<WelfareVariant, "priceDelta">): number {
  return product.price + (variant.priceDelta ?? 0);
}

/**
 * The welfare unit price for one option, or null when it has none (no roles
 * chosen, no price set, or the price isn't below the normal price).
 */
export function welfareUnitPrice(product: WelfareProduct, variant: WelfareVariant): number | null {
  if ((product.welfareRoles?.length ?? 0) === 0) return null;
  const normal = normalUnitPrice(product, variant);
  const welfare = variant.welfarePrice
    ?? (product.welfarePrice != null ? product.welfarePrice + (variant.priceDelta ?? 0) : null);
  return welfare != null && welfare >= 0 && welfare < normal ? welfare : null;
}

/** Does any option of this product carry a usable welfare price? */
export function hasWelfare(product: WelfareProduct, variants: readonly WelfareVariant[]): boolean {
  return variants.some((v) => welfareUnitPrice(product, v) != null);
}

/**
 * What this buyer pays per unit of this option: the welfare price when their
 * roles qualify and the option has one, otherwise the normal price.
 */
export function effectiveUnitPrice(
  product: WelfareProduct,
  variant: WelfareVariant,
  buyerRoles: readonly string[] | null | undefined,
): number {
  const welfare = qualifiesForWelfare(product, buyerRoles) ? welfareUnitPrice(product, variant) : null;
  return welfare ?? normalUnitPrice(product, variant);
}
