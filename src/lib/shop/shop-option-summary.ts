// Per-option order counts for one product — pure logic (no DB), used by the
// "Option summary" panel on /admin/shop/[productId]. The caller passes the
// orders it has already filtered (date range, search, …), so the counts always
// follow whatever the page is showing. Same status split as the "Summary" sheet
// of the product .xlsx export: anything not approved or rejected counts as pending.

export interface OptionSummaryLine {
  productId: string | null;
  variantLabel: string;
  quantity: number;
}

export interface OptionSummaryOrder {
  status: string;
  items: OptionSummaryLine[];
}

export interface OptionSummaryRow {
  option: string;
  approved: number;
  pending: number;
  rejected: number;
  // Approved + pending: how many to actually make / hand over.
  active: number;
  // Distinct orders with at least one line of this option (any status).
  orders: number;
}

export function summarizeOptions(orders: OptionSummaryOrder[], productId: string): { rows: OptionSummaryRow[]; total: OptionSummaryRow } {
  const byOption = new Map<string, OptionSummaryRow>();
  const total: OptionSummaryRow = { option: "", approved: 0, pending: 0, rejected: 0, active: 0, orders: 0 };

  for (const o of orders) {
    const seen = new Set<string>();
    let hasLine = false;
    for (const i of o.items) {
      if (i.productId !== productId) continue;
      hasLine = true;
      const option = i.variantLabel.trim() || "—";
      const row = byOption.get(option) ?? { option, approved: 0, pending: 0, rejected: 0, active: 0, orders: 0 };
      if (o.status === "approved") row.approved += i.quantity;
      else if (o.status === "rejected") row.rejected += i.quantity;
      else row.pending += i.quantity;
      if (!seen.has(option)) { seen.add(option); row.orders++; }
      byOption.set(option, row);
    }
    if (hasLine) total.orders++;
  }

  const rows = [...byOption.values()];
  for (const r of rows) {
    r.active = r.approved + r.pending;
    total.approved += r.approved;
    total.pending += r.pending;
    total.rejected += r.rejected;
  }
  total.active = total.approved + total.pending;
  // Most-made first; ties keep a stable alphabetical order.
  rows.sort((a, b) => b.active - a.active || a.option.localeCompare(b.option));
  return { rows, total };
}
