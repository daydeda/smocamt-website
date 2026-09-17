// One-off, idempotent backfill for shop_order_items.product_name / variant_label
// that went stale from a product/variant rename that happened BEFORE the sync-on-
// rename fix (PUT /api/admin/shop/products/[id], shipped in v2.7.0) existed. That
// fix only propagates a rename going forward, at the moment an admin actually
// changes the name and saves — it does not (and can't, on its own) retroactively
// fix a mismatch that already happened. This script does the one-time catch-up:
// for every order line whose product/variant still exists, overwrite the
// snapshotted product_name / variant_label to match the product/variant's
// CURRENT name, so the order list's product filter/grouping/export stops
// splitting one product's history across an old and a new name.
//
// Deliberately scoped to product_id / variant_id IS NOT NULL: a line whose
// product or variant was later DELETED keeps its last-known snapshot untouched,
// same posture as everywhere else in the shop module (see schema.ts comments on
// shop_order_items.product_name/variant_label).
//
// variant_label handling: a NON-"Other (specify)" variant is a straight
// overwrite. An "Other (specify)" variant (shop_variants.allow_custom = true)
// was snapshotted as "<label>: <what the buyer typed>" — we don't know the
// historical label it was saved under (that's the whole problem), so this
// splits on the FIRST ": " and keeps everything after it as the buyer's typed
// text, rebuilding "<current label>: <buyer text>". This assumes the label
// itself never contains ": " (true for every option label in this shop today:
// "S", "M", "L", "Other", etc.) — a line with no ": " at all (shouldn't happen,
// since checkout requires the custom text) is left untouched rather than guessed.
//
// Safe to re-run: once converged, every row already matches its target value
// and the UPDATE is a no-op for it (the WHERE clause only touches rows that
// still differ).
//
// Run against LOCAL first, then prod:
//   node --env-file=.env.local scripts/backfill-shop-order-item-names.mjs
//   node --env-file=.env       scripts/backfill-shop-order-item-names.mjs
// On the self-hosted deploy, run from the Portainer console inside
// activecamt-app (DATABASE_URL is already in the container env):
//   node scripts/backfill-shop-order-item-names.mjs
// Pass --dry-run to only report what WOULD change, without writing anything.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set — run with --env-file=.env.local (local) or --env-file=.env (prod), or from the Portainer console where it's already in the container env");
const dryRun = process.argv.includes("--dry-run");

const sql = postgres(url, { max: 1, prepare: !url.includes(":6543"), idle_timeout: 5, connect_timeout: 15 });

try {
  const staleProducts = await sql`
    SELECT oi.id, oi.order_id, oi.product_name AS old_name, p.name AS new_name
    FROM shop_order_items oi
    JOIN shop_products p ON p.id = oi.product_id
    WHERE oi.product_name <> p.name
    ORDER BY p.name
  `;
  console.log(`Product name mismatches: ${staleProducts.length}`);
  for (const r of staleProducts.slice(0, 20)) {
    console.log(`  order ${r.order_id}: "${r.old_name}" -> "${r.new_name}"`);
  }
  if (staleProducts.length > 20) console.log(`  ...and ${staleProducts.length - 20} more`);

  const staleVariants = await sql`
    SELECT
      oi.id, oi.order_id, oi.variant_label AS old_label, v.label AS current_label, v.allow_custom,
      CASE
        WHEN v.allow_custom AND position(': ' in oi.variant_label) > 0
          THEN v.label || ': ' || substring(oi.variant_label from position(': ' in oi.variant_label) + 2)
        WHEN v.allow_custom
          THEN oi.variant_label -- no ": " found — leave as-is, don't guess
        ELSE v.label
      END AS new_label
    FROM shop_order_items oi
    JOIN shop_variants v ON v.id = oi.variant_id
    WHERE oi.variant_label <> (
      CASE
        WHEN v.allow_custom AND position(': ' in oi.variant_label) > 0
          THEN v.label || ': ' || substring(oi.variant_label from position(': ' in oi.variant_label) + 2)
        WHEN v.allow_custom
          THEN oi.variant_label
        ELSE v.label
      END
    )
    ORDER BY v.label
  `;
  console.log(`Variant label mismatches: ${staleVariants.length}`);
  for (const r of staleVariants.slice(0, 20)) {
    console.log(`  order ${r.order_id}: "${r.old_label}" -> "${r.new_label}"`);
  }
  if (staleVariants.length > 20) console.log(`  ...and ${staleVariants.length - 20} more`);

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
  } else {
    const productResult = await sql`
      UPDATE shop_order_items oi
      SET product_name = p.name
      FROM shop_products p
      WHERE oi.product_id = p.id AND oi.product_name <> p.name
    `;
    console.log(`\nUpdated product_name on ${productResult.count} row(s).`);

    const variantResult = await sql`
      UPDATE shop_order_items oi
      SET variant_label = CASE
        WHEN v.allow_custom AND position(': ' in oi.variant_label) > 0
          THEN v.label || ': ' || substring(oi.variant_label from position(': ' in oi.variant_label) + 2)
        ELSE v.label
      END
      FROM shop_variants v
      WHERE oi.variant_id = v.id
        AND (v.allow_custom = false OR position(': ' in oi.variant_label) > 0)
        AND oi.variant_label <> (
          CASE
            WHEN v.allow_custom AND position(': ' in oi.variant_label) > 0
              THEN v.label || ': ' || substring(oi.variant_label from position(': ' in oi.variant_label) + 2)
            ELSE v.label
          END
        )
    `;
    console.log(`Updated variant_label on ${variantResult.count} row(s).`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
