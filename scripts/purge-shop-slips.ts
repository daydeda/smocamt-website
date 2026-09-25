// One-off cleanup for shop TEST data: deletes the orders of one product (by the
// product name snapshotted on shop_order_items, so it still works after the product
// itself was deleted) together with their slip images, and/or sweeps orphan slip
// files that no order references.
//
// Why this exists: deleting a product never touches its orders or slips (order
// lines keep a snapshot, product_id is SET NULL), and a slip is uploaded the moment
// the buyer picks an image — BEFORE the order is submitted — so a replaced or
// abandoned pick leaves an orphan file with no GC path. Test runs pile both up.
//
// DRY-RUN BY DEFAULT: without --apply it only reports what WOULD be deleted.
//
// Usage (self-hosted: Portainer console inside activecamt-app; DATABASE_URL is in
// the container env):
//   npx tsx scripts/purge-shop-slips.ts --list-products
//   npx tsx scripts/purge-shop-slips.ts --product "<exact product name>"
//   npx tsx scripts/purge-shop-slips.ts --orphans
//   CONFIRM=yes npx tsx scripts/purge-shop-slips.ts --product "<name>" --orphans --apply --actor <your admin email>
// Locally (rehearse first): npx tsx --env-file=.env.local scripts/purge-shop-slips.ts ...
//
// Safety:
//   - --product matches an order only if EVERY line on it is that product; an order
//     mixing it with other products is reported and skipped, never deleted.
//   - --orphans only deletes app-minted keys ("<uuid>.<ext>") that no shop_orders
//     row references and that are older than 24h (a buyer mid-checkout is safe).
//   - Order deletion + one audit_logs entry commit in one transaction; slip files
//     are deleted only after that commit, and only when no remaining order still
//     references the same key. A failed file delete just leaves an orphan that a
//     later --orphans run picks up.
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { shopOrderItems, shopOrders, users } from "../src/db/schema";
import { assertDestructiveAllowed } from "../src/db/guard";
import { AuditService } from "../src/modules/audit/audit.service";
import { deleteSlip, listSlips } from "../src/lib/shop-storage";

const SLIP_KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const listProducts = args.includes("--list-products");
const orphans = args.includes("--orphans");
const productIdx = args.indexOf("--product");
const productName = productIdx >= 0 ? args[productIdx + 1] : undefined;
const actorIdx = args.indexOf("--actor");
const actorEmail = actorIdx >= 0 ? args[actorIdx + 1] : undefined;

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function printProductNames() {
  const rows = await db
    .select({
      name: shopOrderItems.productName,
      productDeleted: sql<boolean>`bool_and(${shopOrderItems.productId} IS NULL)`,
      orders: sql<number>`count(DISTINCT ${shopOrderItems.orderId})::int`,
    })
    .from(shopOrderItems)
    .groupBy(shopOrderItems.productName)
    .orderBy(shopOrderItems.productName);
  console.log("Product names on existing orders (copy one exactly into --product):\n");
  for (const r of rows) {
    console.log(`  ${String(r.orders).padStart(5)} orders  ${r.productDeleted ? "[product deleted] " : ""}${JSON.stringify(r.name)}`);
  }
}

async function findProductOrders(name: string) {
  const lines = await db
    .select({ orderId: shopOrderItems.orderId, productName: shopOrderItems.productName })
    .from(shopOrderItems)
    .where(inArray(
      shopOrderItems.orderId,
      db.select({ id: shopOrderItems.orderId }).from(shopOrderItems).where(eq(shopOrderItems.productName, name)),
    ));
  const mixed = new Set<string>();
  const candidates = new Set<string>();
  for (const l of lines) {
    candidates.add(l.orderId);
    if (l.productName !== name) mixed.add(l.orderId);
  }
  const pureIds = [...candidates].filter((id) => !mixed.has(id));
  const orders = pureIds.length
    ? await db
        .select({
          id: shopOrders.id,
          status: shopOrders.status,
          slipPath: shopOrders.slipPath,
          createdAt: shopOrders.createdAt,
          buyerEmail: users.email,
        })
        .from(shopOrders)
        .leftJoin(users, eq(users.id, shopOrders.buyerId))
        .where(inArray(shopOrders.id, pureIds))
    : [];
  return { orders, mixedCount: mixed.size };
}

async function main() {
  if (listProducts) {
    await printProductNames();
    return;
  }
  if (!productName && !orphans) {
    console.error("Nothing to do. Pass --list-products, --product \"<name>\", and/or --orphans (add --apply to delete).");
    process.exit(1);
  }
  if (productIdx >= 0 && !productName) {
    console.error("--product needs a name. Run with --list-products to see the exact names.");
    process.exit(1);
  }
  let actorId = "";
  if (apply) {
    assertDestructiveAllowed("purge-shop-slips (deletes shop orders + slip files)");
    // The audit entry must name a real admin, not an anonymous script.
    const [actor] = actorEmail
      ? await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, actorEmail)).limit(1)
      : [];
    if (!actor || (actor.role !== "admin" && actor.role !== "super_admin")) {
      console.error("--apply needs --actor <email of an admin/super_admin account> for the audit log.");
      process.exit(1);
    }
    actorId = actor.id;
  }

  const allSlips = await listSlips();
  const sizeByKey = new Map(allSlips.map((s) => [s.key, s.size]));
  console.log(`Slip storage: ${allSlips.length} files, ${mb(allSlips.reduce((n, s) => n + s.size, 0))}\n`);

  // ---- Orders of one product ------------------------------------------------
  let orderIds: string[] = [];
  let orderSlipKeys: string[] = [];
  if (productName) {
    const { orders, mixedCount } = await findProductOrders(productName);
    orderIds = orders.map((o) => o.id);
    orderSlipKeys = [...new Set(orders.map((o) => o.slipPath).filter((k): k is string => !!k))];

    console.log(`Product ${JSON.stringify(productName)}:`);
    if (orders.length === 0) {
      console.log("  no orders match (check the exact name with --list-products)");
    } else {
      const byStatus = new Map<string, number>();
      const byBuyer = new Map<string, number>();
      for (const o of orders) {
        byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
        const b = o.buyerEmail ?? "(unknown)";
        byBuyer.set(b, (byBuyer.get(b) ?? 0) + 1);
      }
      const dates = orders.map((o) => o.createdAt?.getTime() ?? 0).filter(Boolean).sort((a, b) => a - b);
      console.log(`  orders: ${orders.length}  (${[...byStatus].map(([s, n]) => `${s}: ${n}`).join(", ")})`);
      if (dates.length) {
        console.log(`  created: ${new Date(dates[0]).toISOString()} → ${new Date(dates[dates.length - 1]).toISOString()}`);
      }
      console.log(`  slips: ${orderSlipKeys.length} files, ${mb(orderSlipKeys.reduce((n, k) => n + (sizeByKey.get(k) ?? 0), 0))}`);
      console.log(`  buyers (${byBuyer.size}) — confirm these are all test accounts:`);
      for (const [email, n] of [...byBuyer].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${email}`);
    }
    if (mixedCount) console.log(`  skipped ${mixedCount} order(s) that also contain other products`);
    console.log();
  }

  // ---- Orphan slip files ----------------------------------------------------
  let orphanKeys: string[] = [];
  if (orphans) {
    const referenced = new Set(
      (await db.select({ k: shopOrders.slipPath }).from(shopOrders).where(isNotNull(shopOrders.slipPath)))
        .map((r) => r.k as string),
    );
    const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
    let keptRecent = 0;
    for (const s of allSlips) {
      if (!SLIP_KEY_PATTERN.test(s.key) || referenced.has(s.key)) continue;
      if (s.createdAt > cutoff) keptRecent++;
      else orphanKeys.push(s.key);
    }
    // Don't double-count slips the product purge will already delete.
    const productKeys = new Set(orderSlipKeys);
    orphanKeys = orphanKeys.filter((k) => !productKeys.has(k));
    console.log("Orphan slips (no order references them):");
    console.log(`  ${orphanKeys.length} files, ${mb(orphanKeys.reduce((n, k) => n + (sizeByKey.get(k) ?? 0), 0))}`);
    if (keptRecent) console.log(`  kept ${keptRecent} newer than 24h (may be a checkout in progress)`);
    console.log();
  }

  if (!apply) {
    console.log("DRY RUN — nothing was deleted. Re-run with --apply (and CONFIRM=yes on prod) to delete.");
    return;
  }

  // ---- Apply ----------------------------------------------------------------
  if (orderIds.length) {
    await db.transaction(async (tx) => {
      // shop_order_items cascade with their order.
      await tx.delete(shopOrders).where(inArray(shopOrders.id, orderIds));
      await AuditService.logActionInternal(tx, {
        actorId,
        ipAddress: "cli",
        action: `Purged ${orderIds.length} shop order(s) and ${orderSlipKeys.length} slip(s) for product "${productName}" (scripts/purge-shop-slips.ts)`,
      });
    });
    console.log(`Deleted ${orderIds.length} orders.`);
  }

  // Never delete a file some surviving order still points at.
  let toDelete = [...orderSlipKeys, ...orphanKeys];
  if (toDelete.length) {
    const stillUsed = new Set(
      (await db.select({ k: shopOrders.slipPath }).from(shopOrders).where(inArray(shopOrders.slipPath, toDelete)))
        .map((r) => r.k as string),
    );
    toDelete = toDelete.filter((k) => !stillUsed.has(k));
  }
  const orphanSet = new Set(orphanKeys);
  let deleted = 0;
  let orphansDeleted = 0;
  let freed = 0;
  for (const key of toDelete) {
    try {
      await deleteSlip(key);
      deleted++;
      if (orphanSet.has(key)) orphansDeleted++;
      freed += sizeByKey.get(key) ?? 0;
    } catch (e) {
      console.error(`  failed to delete ${key}:`, e);
    }
  }
  if (orphanKeys.length) {
    await AuditService.logAction({
      actorId,
      ipAddress: "cli",
      action: `Deleted ${orphansDeleted} orphan shop slip file(s) (scripts/purge-shop-slips.ts)`,
    });
  }
  console.log(`Deleted ${deleted}/${toDelete.length} slip files, freed ${mb(freed)}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
