// Shop financial summary — pure logic (no DB), shared by
// /api/admin/shop/finance and its tests.
//
// Money on an order is stored as snapshots: each line keeps unitPrice ×
// quantity, while the promotion discount and the shipping fee are ORDER-level
// (shop_orders.discountAmount / shippingFee). To report per product, each
// order's discount and shipping are split across its lines in proportion to
// the line's gross, using the largest-remainder method so the shares are whole
// baht and always add back up to the order amount exactly.

export type FinanceStatus = "approved" | "pending" | "rejected";

export interface FinanceOrderLine {
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
}

export interface FinanceOrder {
  id: string;
  status: string;
  discountAmount: number;
  shippingFee: number;
  sellerName: string | null;
  // EVERY line of the order — needed so the discount/shipping split is computed
  // against the whole order even when the caller only sees some products.
  items: FinanceOrderLine[];
}

export interface FinanceBucket {
  orders: number;
  units: number;
  gross: number;
  discount: number;
  shipping: number;
  net: number;
}

export interface ProductFinanceRow {
  key: string;
  productId: string | null;
  productName: string;
  sellerName: string | null;
  approved: FinanceBucket;
  pending: FinanceBucket;
  rejected: FinanceBucket;
}

export interface FinanceSummary {
  rows: ProductFinanceRow[];
  totals: Record<FinanceStatus, FinanceBucket>;
}

const emptyBucket = (): FinanceBucket => ({ orders: 0, units: 0, gross: 0, discount: 0, shipping: 0, net: 0 });

// Anything that isn't approved/rejected (i.e. "pending") is money not yet confirmed.
export function financeStatus(status: string): FinanceStatus {
  return status === "approved" || status === "rejected" ? status : "pending";
}

// Split `amount` across `weights` in proportion, as whole numbers that sum to
// `amount` exactly (largest remainder; ties go to the earlier index). All-zero
// weights put the whole amount on the first slot.
export function allocateProportionally(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0) return weights.map(() => 0);
  if (total <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));
  const exact = weights.map((w) => (amount * w) / total);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) shares[order[k].i]++;
  return shares;
}

// Per-order breakdown. The order's own totalAmount is the charged snapshot;
// subtotal is derived from it so the figures always reconcile with the total
// the buyer paid, even when a scoped viewer can only see some of the lines.
export function orderBreakdown(order: { totalAmount: number; discountAmount: number; shippingFee: number }) {
  return {
    subtotal: order.totalAmount + order.discountAmount - order.shippingFee,
    discount: order.discountAmount,
    shipping: order.shippingFee,
    total: order.totalAmount,
  };
}

// Group money by product and order status. `includeLine` limits which lines
// count (a scoped president only sees their own products); every line still
// takes part in the discount/shipping split so shares stay correct.
export function summarizeByProduct<O extends FinanceOrder>(
  orders: O[],
  includeLine: (line: FinanceOrderLine, order: O) => boolean = () => true,
): FinanceSummary {
  const rows = new Map<string, ProductFinanceRow>();
  const totals: Record<FinanceStatus, FinanceBucket> = {
    approved: emptyBucket(),
    pending: emptyBucket(),
    rejected: emptyBucket(),
  };

  for (const order of orders) {
    const status = financeStatus(order.status);
    const gross = order.items.map((l) => l.unitPrice * l.quantity);
    const discounts = allocateProportionally(order.discountAmount, gross);
    const shipping = allocateProportionally(order.shippingFee, gross);
    const seenInOrder = new Set<string>();
    let orderCounted = false;

    order.items.forEach((line, i) => {
      if (!includeLine(line, order)) return;
      // A deleted product (productId NULL) is grouped by its snapshot name.
      const key = line.productId ?? `name:${line.productName}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          productId: line.productId,
          productName: line.productName,
          sellerName: order.sellerName,
          approved: emptyBucket(),
          pending: emptyBucket(),
          rejected: emptyBucket(),
        };
        rows.set(key, row);
      }
      const net = gross[i] - discounts[i] + shipping[i];
      for (const bucket of [row[status], totals[status]]) {
        bucket.units += line.quantity;
        bucket.gross += gross[i];
        bucket.discount += discounts[i];
        bucket.shipping += shipping[i];
        bucket.net += net;
      }
      if (!seenInOrder.has(key)) {
        seenInOrder.add(key);
        row[status].orders++;
      }
      if (!orderCounted) {
        orderCounted = true;
        totals[status].orders++;
      }
    });
  }

  const list = [...rows.values()].sort(
    (a, b) =>
      b.approved.net + b.pending.net - (a.approved.net + a.pending.net) ||
      a.productName.localeCompare(b.productName),
  );
  return { rows: list, totals };
}
