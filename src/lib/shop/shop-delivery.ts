import { z } from "zod";

// Per-product delivery pricing. A product may override the shop-wide flat fee
// (shop_settings.deliveryFee) with its own base fee + quantity tiers — i.e.
// "order more than N of this product → the delivery fee goes up to ฿Y".
//
// computeProductDeliveryFee is the SINGLE source of truth, reused by:
//   - the storefront (ShopClient) to show a live estimate, and
//   - POST /api/shop/orders to compute the charged shippingFee (authoritative).
// An order's total shipping = SUM of each product's computed fee (see the order route).

export interface ShopDeliveryTier {
  minQty: number; // applies when the buyer's qty of THIS product is >= minQty
  fee: number;    // ฿ delivery fee at this tier (overrides the base + lower tiers)
}

// The slice of a product this module needs (storefront + admin + order route).
export interface ProductDeliveryConfig {
  deliveryFee?: number | null;                // base ฿ fee; null/undefined = use shop-wide fallback
  deliveryTiers?: ShopDeliveryTier[] | null;  // ascending thresholds; highest applicable wins
}

export const deliveryTierSchema = z.object({
  minQty: z.number().int().min(1).max(100_000),
  fee: z.number().int().min(0).max(1_000_000),
});

/**
 * Delivery fee for ONE product given the ordered quantity. The highest tier whose
 * minQty <= qty wins; with no applicable tier it falls back to the product's base
 * fee, then to the shop-wide fee. Server-authoritative — never trust a client fee.
 */
export function computeProductDeliveryFee(
  product: ProductDeliveryConfig,
  qty: number,
  shopWideFallback: number
): number {
  const base = product.deliveryFee ?? shopWideFallback;
  const applicable = (product.deliveryTiers ?? []).filter((t) => qty >= t.minQty);
  if (applicable.length === 0) return Math.max(0, base);
  const best = applicable.reduce((a, b) => (b.minQty > a.minQty ? b : a));
  return Math.max(0, best.fee);
}

/**
 * Canonicalize tiers for storage: drop blanks, dedupe by minQty (last wins),
 * sort ascending. Keeps the admin editor forgiving and the stored array tidy.
 */
export function normalizeTiers(tiers: ShopDeliveryTier[]): ShopDeliveryTier[] {
  const byMin = new Map<number, number>();
  for (const t of tiers) {
    if (!Number.isInteger(t.minQty) || t.minQty < 1) continue;
    byMin.set(t.minQty, Math.max(0, Math.round(t.fee) || 0));
  }
  return [...byMin.entries()]
    .map(([minQty, fee]) => ({ minQty, fee }))
    .sort((a, b) => a.minQty - b.minQty);
}
