import { z } from "zod";

// Per-product bundle promotions — "buy N for ฿X" (e.g. 3 for ฿100). A product may
// carry several deals (e.g. 3 for ฿100 AND 5 for ฿150); the buyer always gets the
// cheapest combination of deals + single units for the quantity they order.
//
// Scope rules:
//   - A deal applies to ALL of the product's options (variantIds absent) or only
//     to specific options (variantIds, e.g. only "Screen print", not "Embroidered").
//     Units of every eligible option in ONE order count together (S + M + L toward
//     "3 for ฿100"). Prior orders never count.
//   - Deals sharing the exact same option set form a group; different groups must
//     not overlap (see findBundleScopeConflict), so every unit belongs to at most
//     one group and the pricing stays unambiguous.
//   - A group's REFERENCE price is the cheapest unit price (product.price +
//     priceDelta) among its eligible options. The deal replaces that reference
//     price; a pricier eligible option still pays its difference on top (e.g. XXL
//     +฿20). This also works when the base price is ฿0 and every option is priced
//     purely through its surcharge.
//
// computeBundleDiscount is the SINGLE source of truth, reused by:
//   - the storefront (ShopClient) to show a live estimate,
//   - POST /api/shop/orders to compute the charged discount (authoritative), and
//   - PUT /api/admin/shop/orders/[id] when an admin changes a quantity/option.
// Order lines keep their full unitPrice; the order snapshots the total saving on
// shop_orders.discount_amount (total = lines − discount + shipping).

export interface ShopBundleDeal {
  qty: number;          // units in the bundle (>= 2)
  price: number;        // ฿ for the whole bundle
  variantIds?: string[]; // absent = every option of the product; else only these
}

export interface ProductBundleConfig {
  price: number;                              // base unit price (฿)
  bundleDeals?: ShopBundleDeal[] | null;
}

export interface BundleVariant {
  id: string;
  priceDelta?: number | null;
}

// What the admin form submits: options are referenced by their INDEX in the
// submitted variants array, because brand-new options have no id until saved.
// The product routes resolve indexes to ids (resolveBundleDeals) before storing.
export const bundleDealSchema = z.object({
  qty: z.number().int().min(2).max(999),
  price: z.number().int().min(0).max(1_000_000),
  variantIndexes: z.array(z.number().int().min(0).max(29)).min(1).max(30).optional(),
});
export type BundleDealInput = z.infer<typeof bundleDealSchema>;

/**
 * Cheapest ฿ cost for `qty` units at `unitPrice`, mixing bundles and single units
 * freely (unbounded-knapsack DP — greedy "largest bundle first" isn't always
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

// Canonical key for a deal's option set ("*" = all options).
const scopeKey = (d: Pick<ShopBundleDeal, "variantIds">) =>
  d.variantIds ? [...new Set(d.variantIds)].sort().join(",") : "*";

/**
 * ฿ saved on ONE product for the given per-option quantities (0 when no deal
 * applies). `variants` must be ALL of the product's options (not just the ordered
 * ones), since a group's reference price is the cheapest of its eligible options.
 * Never negative.
 */
export function computeBundleDiscount(
  product: ProductBundleConfig,
  variants: BundleVariant[],
  qtyByVariant: ReadonlyMap<string, number>
): number {
  const deals = product.bundleDeals ?? [];
  if (deals.length === 0) return 0;

  // Group deals by identical option set, in first-appearance order.
  const groups = new Map<string, ShopBundleDeal[]>();
  for (const d of deals) {
    const key = scopeKey(d);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const unitPriceOf = (v: BundleVariant) => product.price + (v.priceDelta ?? 0);
  const claimed = new Set<string>(); // a unit counts toward at most one group
  let discount = 0;
  for (const [key, groupDeals] of groups) {
    const ids = key === "*" ? null : new Set(key.split(","));
    const eligible = variants.filter((v) => !ids || ids.has(v.id));
    if (eligible.length === 0) continue; // every scoped option was since deleted
    const ref = Math.min(...eligible.map(unitPriceOf));
    let units = 0;
    for (const v of eligible) {
      if (claimed.has(v.id)) continue;
      claimed.add(v.id);
      units += Math.max(0, Math.floor(qtyByVariant.get(v.id) ?? 0));
    }
    discount += Math.max(0, ref * units - computeBundleCost(ref, units, groupDeals));
  }
  return discount;
}

/**
 * True when two deals cover different option sets that still share an option
 * (e.g. "all options" + "only Screen print"). Such a unit could count toward
 * either deal, so the admin must use identical or completely separate sets.
 */
export function findBundleScopeConflict(deals: Pick<ShopBundleDeal, "variantIds">[], allVariantIds: string[]): boolean {
  const sets = [...new Set(deals.map(scopeKey))].map((key) => new Set(key === "*" ? allVariantIds : key.split(",")));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      for (const id of sets[i]) if (sets[j].has(id)) return true;
    }
  }
  return false;
}

/**
 * Canonicalize deals for storage: drop invalid rows, sort + dedupe each option
 * set, dedupe by (option set, qty) with the last one winning, and sort by option
 * set then qty. Mirrors normalizeTiers in shop-delivery.ts.
 */
export function normalizeBundleDeals(deals: ShopBundleDeal[]): ShopBundleDeal[] {
  const byKey = new Map<string, ShopBundleDeal>();
  for (const d of deals) {
    if (!Number.isInteger(d.qty) || d.qty < 2) continue;
    const variantIds = d.variantIds ? [...new Set(d.variantIds)].sort() : undefined;
    if (variantIds && variantIds.length === 0) continue;
    const deal: ShopBundleDeal = { qty: d.qty, price: Math.max(0, Math.round(d.price) || 0), ...(variantIds ? { variantIds } : {}) };
    byKey.set(`${scopeKey(deal)}|${d.qty}`, deal);
  }
  return [...byKey.values()].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)) || a.qty - b.qty);
}

/**
 * Turn submitted deals (options referenced by index into the submitted variants
 * array) into stored deals (options referenced by id). `variantIds[i]` is the id
 * the product route assigned to submitted variant i. Returns an error string when
 * an index is out of range or two deals' option sets overlap.
 */
export function resolveBundleDeals(
  input: BundleDealInput[],
  variantIds: string[]
): { ok: true; deals: ShopBundleDeal[] } | { ok: false; error: string } {
  const resolved: ShopBundleDeal[] = [];
  for (const d of input) {
    if (!d.variantIndexes) {
      resolved.push({ qty: d.qty, price: d.price });
      continue;
    }
    const ids = d.variantIndexes.map((i) => variantIds[i]);
    if (ids.some((id) => !id)) return { ok: false, error: "A promotion refers to an option that doesn't exist." };
    // Covering every option is the same as "all options" (and survives new options).
    const all = new Set(ids).size === variantIds.length;
    resolved.push(all ? { qty: d.qty, price: d.price } : { qty: d.qty, price: d.price, variantIds: ids });
  }
  const deals = normalizeBundleDeals(resolved);
  if (findBundleScopeConflict(deals, variantIds)) {
    return { ok: false, error: "Promotions must cover either exactly the same options or completely different options." };
  }
  return { ok: true, deals };
}
