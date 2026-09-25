import { z } from "zod";

// Per-product bundle promotions — "buy N for ฿X" (e.g. 3 for ฿100). A product may
// carry several deals (e.g. 3 for ฿100 AND 5 for ฿150); the buyer always gets the
// cheapest combination of deals + single units for the quantity they order.
//
// Scope rules:
//   - Counted per PRODUCT, across all of its variants in ONE order (S + M + L
//     together count toward "3 for ฿100"). Prior orders never count.
//   - A deal replaces the BASE product price only. Variant surcharges
//     (shop_variants.priceDelta, e.g. XXL +฿20) are always charged on top.
//
// computeBundleDiscount is the SINGLE source of truth, reused by:
//   - the storefront (ShopClient) to show a live estimate,
//   - POST /api/shop/orders to compute the charged discount (authoritative), and
//   - PUT /api/admin/shop/orders/[id] when an admin changes a quantity.
// Order lines keep their full unitPrice; the order snapshots the total saving on
// shop_orders.discount_amount (total = lines − discount + shipping).

export interface ShopBundleDeal {
  qty: number;   // units in the bundle (>= 2)
  price: number; // ฿ for the whole bundle
}

export interface ProductBundleConfig {
  price: number;                              // base unit price (฿)
  bundleDeals?: ShopBundleDeal[] | null;
}

export const bundleDealSchema = z.object({
  qty: z.number().int().min(2).max(999),
  price: z.number().int().min(0).max(1_000_000),
});

/**
 * Cheapest ฿ cost for `qty` units at the base price, mixing bundles and single
 * units freely (unbounded-knapsack DP — greedy "largest bundle first" isn't always
 * optimal). A deal that's no cheaper than singles simply never gets picked.
 */
export function computeBundleCost(unitPrice: number, qty: number, deals: ShopBundleDeal[] | null | undefined): number {
  const n = Math.max(0, Math.floor(qty));
  const usable = (deals ?? []).filter((d) => d.qty >= 2 && d.qty <= n && d.price >= 0);
  if (usable.length === 0) return unitPrice * n;
  const cost = new Array<number>(n + 1);
  cost[0] = 0;
  for (let i = 1; i <= n; i++) {
    let best = cost[i - 1] + unitPrice;
    for (const d of usable) {
      if (d.qty <= i) best = Math.min(best, cost[i - d.qty] + d.price);
    }
    cost[i] = best;
  }
  return cost[n];
}

/** ฿ saved on ONE product for `qty` units (0 when no deal applies). Never negative. */
export function computeBundleDiscount(product: ProductBundleConfig, qty: number): number {
  const full = product.price * Math.max(0, Math.floor(qty));
  return Math.max(0, full - computeBundleCost(product.price, qty, product.bundleDeals));
}

/**
 * Canonicalize deals for storage: drop invalid rows, dedupe by qty (last wins),
 * sort ascending. Mirrors normalizeTiers in shop-delivery.ts.
 */
export function normalizeBundleDeals(deals: ShopBundleDeal[]): ShopBundleDeal[] {
  const byQty = new Map<number, number>();
  for (const d of deals) {
    if (!Number.isInteger(d.qty) || d.qty < 2) continue;
    byQty.set(d.qty, Math.max(0, Math.round(d.price) || 0));
  }
  return [...byQty.entries()]
    .map(([qty, price]) => ({ qty, price }))
    .sort((a, b) => a.qty - b.qty);
}
