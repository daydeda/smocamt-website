// One-off backfill: runs the slip amount check (src/lib/shop-slip-amount.ts) on
// orders that were placed BEFORE it shipped (v2.22.0), so their review cards get
// the same "amount doesn't match" / "couldn't read the amount" label that new
// orders get at creation. Only pending orders by default, since those are the
// ones still waiting on a review.
//
// It re-reads each order's stored slip, OCRs the amount and compares it with the
// order's total_amount, exactly like order creation does. It only ever writes
// shop_orders.slip_flag, and never touches an order that already carries a
// duplicate_image / duplicate_qr / no_qr flag (those outrank an amount flag, same
// as at creation). Re-running is safe: orders that already have an amount flag
// are re-checked and corrected, and the rest are skipped.
//
// DRY-RUN BY DEFAULT: without --apply it only reports what it WOULD set.
//
// Usage (self-hosted: Portainer console inside activecamt-app; DATABASE_URL is in
// the container env):
//   npx tsx scripts/backfill-slip-amount-flag.ts
//   npx tsx scripts/backfill-slip-amount-flag.ts --apply --actor <your admin email>
//   add --all-statuses to include approved/rejected orders too
// Locally (rehearse first): npx tsx --env-file=.env.local scripts/backfill-slip-amount-flag.ts
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../src/db";
import { shopOrders, users } from "../src/db/schema";
import { AuditService } from "../src/modules/audit/audit.service";
import { classifySlipAmount, readSlipAmounts } from "../src/lib/shop/shop-slip-amount";
import { downloadSlip } from "../src/lib/shop/shop-storage";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allStatuses = args.includes("--all-statuses");
const actorIdx = args.indexOf("--actor");
const actorEmail = actorIdx >= 0 ? args[actorIdx + 1] : undefined;

const fmt = (satang: number[] | null) =>
  satang === null ? "OCR failed" : satang.length ? satang.map((s) => (s / 100).toFixed(2)).join(", ") : "none found";

async function main() {
  let actorId = "";
  if (apply) {
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

  const orders = await db
    .select({
      id: shopOrders.id,
      status: shopOrders.status,
      slipPath: shopOrders.slipPath,
      slipFlag: shopOrders.slipFlag,
      totalAmount: shopOrders.totalAmount,
    })
    .from(shopOrders)
    .where(and(
      isNotNull(shopOrders.slipPath),
      allStatuses ? undefined : eq(shopOrders.status, "pending"),
      // Leave duplicate_*/no_qr alone; re-check anything clean or already amount-flagged.
      or(isNull(shopOrders.slipFlag), inArray(shopOrders.slipFlag, ["amount_mismatch", "amount_unreadable"])),
    ));

  console.log(`${orders.length} order(s) to check${allStatuses ? "" : " (pending only)"}.\n`);

  let mismatch = 0, unreadable = 0, ok = 0, missing = 0, changed = 0;
  for (const o of orders) {
    let amounts: number[] | null;
    try {
      const { buffer } = await downloadSlip(o.slipPath!);
      amounts = await readSlipAmounts(buffer);
    } catch (e) {
      // Slip file gone from storage: nothing to read, leave the order untouched.
      console.error(`  ${o.id.slice(0, 8)}  slip file missing/unreadable, skipped:`, e instanceof Error ? e.message : e);
      missing++;
      continue;
    }
    const flag = classifySlipAmount(o.totalAmount, amounts);
    if (flag === "amount_mismatch") mismatch++;
    else if (flag === "amount_unreadable") unreadable++;
    else ok++;

    const willChange = flag !== o.slipFlag;
    console.log(
      `  ${o.id.slice(0, 8)}  ${o.status.padEnd(8)} total ฿${o.totalAmount}  slip: ${fmt(amounts)}  → ${flag ?? "ok"}${willChange ? "" : " (unchanged)"}`,
    );
    if (apply && willChange) {
      // Guard on the flag we read so a concurrent review/edit isn't clobbered.
      await db
        .update(shopOrders)
        .set({ slipFlag: flag })
        .where(and(
          eq(shopOrders.id, o.id),
          o.slipFlag === null ? isNull(shopOrders.slipFlag) : eq(shopOrders.slipFlag, o.slipFlag),
        ));
      changed++;
    }
  }

  console.log(`\nmismatch: ${mismatch}, unreadable: ${unreadable}, ok: ${ok}, slip missing: ${missing}`);
  if (!apply) {
    console.log("DRY RUN — nothing was changed. Re-run with --apply --actor <admin email> to set the flags.");
    return;
  }
  await AuditService.logAction({
    actorId,
    ipAddress: "cli",
    action: `Backfilled slip amount flags on ${changed} shop order(s) (scripts/backfill-slip-amount-flag.ts)`,
  });
  console.log(`Updated ${changed} order(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
