// One-off, idempotent rebuild of shop_products from order history, for when the
// products were deleted but the orders survived. Deleting a product sets
// shop_order_items.product_id / variant_id to NULL (ON DELETE SET NULL) and
// cascades its shop_variants away, which breaks the Digital ID handover counter:
// the product picker lists shop_products rows, and the scan + handOverItems match
// order lines by product_id (src/app/api/admin/shop/fulfillment/*,
// src/lib/shop-fulfillment-server.ts).
//
// What it does, per distinct shop_order_items.product_name among lines whose
// product_id IS NULL (exact string match, never split by size/colour):
//   1. Reuse a product that already has exactly that name, or create one.
//   2. For a product it creates, add one shop_variants row per distinct
//      variant_label seen on those lines (exact text, never parsed: an
//      "Other (specify)" line is stored as "<label>: <typed>", and splitting on
//      ": " once corrupted real data, see backfill-shop-order-item-names.mjs).
//   3. Set product_id on those order lines, and variant_id where it is empty and
//      the line's stored label matches exactly ONE option of that product (so
//      "sold" counts per option and the order-edit screen work again). A line
//      with no unique match keeps variant_id NULL and is listed in the report.
//      NOTHING else on the line or the order is touched: handover stamps,
//      slips, statuses, prices and totals are unchanged.
//
// Defaults for fields the order data can't supply (see DEFAULTS below):
//   - price: lowest of each option's most recent unit_price; the difference
//     becomes that option's priceDelta. Options keep NULL (unlimited) stock.
//   - is_active = false, so nothing goes back on sale until an admin reviews it.
//   - approval_status = 'approved' (these were live products).
//   - seller_id: the orders' seller when every order for that name has the same
//     one; otherwise NULL (central SMO product). Club/major owners can't be
//     recovered, so owner_club_ids / owner_majors are empty.
//   - custom_fields: one optional text field per distinct custom_values label.
//   - description: a note saying the product was rebuilt; no images, no sale
//     window, no per-buyer limit, no audience limits, no delivery overrides, no
//     bundle deals.
//
// Idempotent: only lines with product_id IS NULL are linked, and an existing
// product with the same name is reused, so a second run changes nothing. A name
// shared by 2+ existing products is ambiguous and skipped (listed at the end).
// No audit_logs rows are written: that table is a hash chain maintained by
// AuditService, and a raw insert here would break it.
//
// Run LOCAL first, then prod. Always --dry-run first:
//   node --env-file=.env.local scripts/rebuild-shop-products-from-orders.mjs --dry-run
// On the self-hosted deploy, from the Portainer console inside activecamt-app
// (DATABASE_URL is already in the container env):
//   node scripts/rebuild-shop-products-from-orders.mjs --dry-run
//   node scripts/rebuild-shop-products-from-orders.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set — run with --env-file=.env.local (local), or from the Portainer console where it's already in the container env");
const dryRun = process.argv.includes("--dry-run");

const today = new Date().toISOString().slice(0, 10);
const DEFAULTS = {
  description: `Rebuilt from order history on ${today}. Please add the description, images and sale settings again before reopening.\n\nสร้างใหม่จากประวัติคำสั่งซื้อ กรุณาใส่รายละเอียด รูปภาพ และการตั้งค่าการขายอีกครั้งก่อนเปิดขาย`,
  isActive: false,
  approvalStatus: "approved",
};

const sql = postgres(url, { max: 1, prepare: !url.includes(":6543"), idle_timeout: 5, connect_timeout: 15 });

async function buildPlan(tx) {
  // Every orphaned line, with its order's seller and date (newest first so the
  // first price seen per option is its most recent one).
  const lines = await tx`
    SELECT oi.id, oi.order_id, oi.product_name, oi.variant_label, oi.variant_id, oi.unit_price,
           oi.quantity, oi.custom_values, o.seller_id, o.created_at
    FROM shop_order_items oi
    JOIN shop_orders o ON o.id = oi.order_id
    WHERE oi.product_id IS NULL
    ORDER BY o.created_at DESC, oi.id
  `;
  const existing = await tx`SELECT id, name FROM shop_products`;
  const existingVariants = await tx`SELECT id, product_id, label FROM shop_variants`;
  const existingByName = new Map();
  for (const p of existing) existingByName.set(p.name, [...(existingByName.get(p.name) ?? []), p.id]);

  const groups = new Map();
  for (const l of lines) {
    l.created_at ??= new Date(0);
    let g = groups.get(l.product_name);
    if (!g) {
      g = { name: l.product_name, lines: [], options: new Map(), sellers: new Set(), fieldLabels: [], firstOrderAt: l.created_at };
      groups.set(l.product_name, g);
    }
    g.lines.push(l);
    g.sellers.add(l.seller_id ?? null);
    if (l.created_at < g.firstOrderAt) g.firstOrderAt = l.created_at;
    const opt = g.options.get(l.variant_label);
    if (!opt) g.options.set(l.variant_label, { label: l.variant_label, latestUnitPrice: l.unit_price, lines: 1, qty: l.quantity });
    else { opt.lines++; opt.qty += l.quantity; }
    for (const cv of Array.isArray(l.custom_values) ? l.custom_values : []) {
      if (cv?.label && !g.fieldLabels.includes(cv.label)) g.fieldLabels.push(cv.label);
    }
  }

  const plan = [];
  const skipped = [];
  for (const g of [...groups.values()].sort((a, b) => a.firstOrderAt - b.firstOrderAt)) {
    const matches = existingByName.get(g.name) ?? [];
    if (matches.length > 1) { skipped.push({ ...g, reason: `${matches.length} existing products share this exact name` }); continue; }
    const options = [...g.options.values()].sort((a, b) => a.label.localeCompare(b.label));
    // For a reused product, which line labels match exactly one existing option?
    // (A product we create gets one option per label, so every line matches.)
    let unmatchedVariantLines = [];
    if (matches[0]) {
      const byLabel = new Map();
      for (const v of existingVariants.filter((v) => v.product_id === matches[0])) byLabel.set(v.label, (byLabel.get(v.label) ?? 0) + 1);
      unmatchedVariantLines = g.lines.filter((l) => !l.variant_id && byLabel.get(l.variant_label) !== 1);
    }
    const price = Math.min(...options.map((o) => o.latestUnitPrice));
    const sellers = [...g.sellers];
    plan.push({
      ...g,
      reuseId: matches[0] ?? null,
      price,
      options: options.map((o) => ({ ...o, priceDelta: o.latestUnitPrice - price })),
      unmatchedVariantLines,
      sellerId: sellers.length === 1 ? sellers[0] : null,
      mixedSellers: sellers.length > 1,
    });
  }

  // Names that differ only by case/spacing stay separate products; flag them,
  // comparing against existing products' names too.
  const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const byNorm = new Map();
  for (const n of new Set([...groups.keys(), ...existingByName.keys()])) byNorm.set(norm(n), [...(byNorm.get(norm(n)) ?? []), n]);
  const nearDuplicates = [...byNorm.values()].filter((ns) => ns.length > 1 && ns.some((n) => groups.has(n)));

  return { lines, plan, skipped, nearDuplicates };
}

function printPlan({ lines, plan, skipped, nearDuplicates }) {
  console.log(`${dryRun ? "[DRY RUN] " : ""}Order lines with no product: ${lines.length}`);
  console.log(`Distinct item names: ${plan.length + skipped.length}\n`);
  for (const p of plan) {
    console.log(`${p.reuseId ? "REUSE existing product" : "CREATE product"} "${p.name}"${p.reuseId ? ` (${p.reuseId})` : ""}`);
    console.log(`  lines to link: ${p.lines.length}  (orders: ${new Set(p.lines.map((l) => l.order_id)).size})`);
    if (!p.reuseId) {
      console.log(`  price: ฿${p.price}   seller_id: ${p.sellerId ?? "NULL (central SMO)"}${p.mixedSellers ? "   ⚠ orders span several sellers, left central" : ""}`);
      console.log(`  options (${p.options.length}):`);
      for (const o of p.options) console.log(`    - "${o.label}"  ${o.priceDelta ? `+฿${o.priceDelta}  ` : ""}(${o.lines} line(s), qty ${o.qty})`);
      if (p.fieldLabels.length) console.log(`  custom text fields: ${p.fieldLabels.map((l) => `"${l}"`).join(", ")}`);
    }
    const needOption = p.lines.filter((l) => !l.variant_id).length;
    const variantLinks = needOption - p.unmatchedVariantLines.length;
    console.log(`  option links (variant_id): ${variantLinks} of ${needOption} line(s) without one${p.unmatchedVariantLines.length ? `, ${p.unmatchedVariantLines.length} with no unique matching option` : ""}`);
    console.log("");
  }
  if (nearDuplicates.length) {
    console.log("⚠ Names that differ only by case/spacing (kept as separate products):");
    for (const ns of nearDuplicates) console.log(`  ${ns.map((n) => `"${n}"`).join("  vs  ")}`);
    console.log("");
  }
  const toLink = plan.reduce((n, p) => n + p.lines.length, 0);
  console.log(`Summary: create ${plan.filter((p) => !p.reuseId).length} product(s), reuse ${plan.filter((p) => p.reuseId).length}, link ${toLink} line(s) to a product (${plan.reduce((n, p) => n + p.lines.filter((l) => !l.variant_id).length - p.unmatchedVariantLines.length, 0)} also to an option), skip ${skipped.reduce((n, s) => n + s.lines.length, 0)} line(s).`);
}

function printUnmatched(skipped) {
  if (!skipped.length) { console.log("Unmatched order lines: none"); return; }
  console.log("Unmatched order lines (not linked):");
  for (const s of skipped) {
    console.log(`  "${s.name}": ${s.reason}`);
    for (const l of s.lines) console.log(`    line ${l.id}  order ${l.order_id}  "${l.variant_label}" x${l.quantity}`);
  }
}

try {
  if (dryRun) {
    const result = await buildPlan(sql);
    printPlan(result);
    printUnmatched(result.skipped);
  } else {
    const report = await sql.begin(async (tx) => {
      const result = await buildPlan(tx);
      printPlan(result);
      let created = 0, linked = 0, linkedVariants = 0;
      for (const [i, p] of result.plan.entries()) {
        let productId = p.reuseId;
        if (!productId) {
          const fields = p.fieldLabels.map((label, k) => ({ key: `cf${k + 1}`, label, type: "text", required: false, maxLength: null, min: null, max: null, options: [] }));
          const [row] = await tx`
            INSERT INTO shop_products ${tx({
              name: p.name,
              description: DEFAULTS.description,
              price: p.price,
              image_urls: tx.json([]),
              is_active: DEFAULTS.isActive,
              allowed_roles: tx.json([]),
              allowed_majors: tx.json([]),
              custom_fields: tx.json(fields),
              delivery_tiers: tx.json([]),
              bundle_deals: tx.json([]),
              owner_club_ids: tx.json([]),
              owner_majors: tx.json([]),
              seller_id: p.sellerId,
              approval_status: DEFAULTS.approvalStatus,
              sort_order: i,
            })}
            RETURNING id
          `;
          productId = row.id;
          created++;
          for (const [k, o] of p.options.entries()) {
            await tx`INSERT INTO shop_variants ${tx({ product_id: productId, label: o.label, stock: null, price_delta: o.priceDelta, allow_custom: false, sort_order: k })}`;
          }
        }
        const updated = await tx`
          UPDATE shop_order_items SET product_id = ${productId}
          WHERE product_id IS NULL AND product_name = ${p.name}
          RETURNING id
        `;
        linked += updated.length;
        // Option link: only for the lines just linked, only where variant_id is
        // still empty, only on an exact, unambiguous label match.
        const variantLinked = updated.length === 0 ? [] : await tx`
          UPDATE shop_order_items oi SET variant_id = v.id
          FROM shop_variants v
          WHERE oi.id IN ${tx(updated.map((r) => r.id))}
            AND oi.variant_id IS NULL
            AND v.product_id = ${productId}
            AND v.label = oi.variant_label
            AND (SELECT count(*) FROM shop_variants v2 WHERE v2.product_id = ${productId} AND v2.label = oi.variant_label) = 1
          RETURNING oi.id
        `;
        linkedVariants += variantLinked.length;
      }
      const [left] = await tx`SELECT count(*)::int AS n FROM shop_order_items WHERE product_id IS NULL`;
      const noOption = result.plan.length === 0 ? [] : await tx`
        SELECT oi.id, oi.order_id, oi.product_name, oi.variant_label, oi.quantity
        FROM shop_order_items oi
        WHERE oi.product_id IS NOT NULL AND oi.variant_id IS NULL
          AND oi.product_name IN ${tx(result.plan.map((p) => p.name))}
      `;
      return { created, linked, linkedVariants, noOption, stillUnlinked: left.n, skipped: result.skipped };
    });
    console.log(`\nDone. Products created: ${report.created}. Order lines linked to a product: ${report.linked}. Linked to an option: ${report.linkedVariants}. Lines still without a product: ${report.stillUnlinked}.`);
    if (report.noOption.length) {
      console.log("Lines linked to a product but with no unique matching option (variant_id left empty):");
      for (const l of report.noOption) console.log(`    line ${l.id}  order ${l.order_id}  "${l.product_name}" / "${l.variant_label}" x${l.quantity}`);
    }
    printUnmatched(report.skipped);
  }
} finally {
  await sql.end();
}
