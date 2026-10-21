import { createHash } from "crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { asc, desc, gt, sql } from "drizzle-orm";

// Fixed key for the transaction-scoped advisory lock that serializes audit-log
// appends. Without it, two concurrent transactions can read the same chain tip and
// both link to it, forking the hash chain. The lock makes every append wait for the
// previous one's tip to commit. Released automatically at transaction end.
const AUDIT_CHAIN_LOCK_KEY = 919273;

// Client IP as seen behind our nginx reverse proxy.
//
// SECURITY: prefer X-Real-IP — nginx OVERWRITES it with the real $remote_addr, so
// it can't be spoofed. X-Forwarded-For is only trustworthy at its LAST hop (nginx
// APPENDS the real IP), so never trust the leftmost entry, which is client-supplied
// and would otherwise forge the IP recorded in the tamper-evident audit log.
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "127.0.0.1";
}

export interface LogActionParams {
  actorId: string;
  targetId?: string;
  action: string;
  ipAddress: string;
}

export interface ChainVerifyResult {
  valid: boolean;
  totalRows: number;
  hashedRows: number;
  firstBreakIndex: number | null;
  firstBreakId: string | null;
  reason: string;
}

type DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Sentinel prevHash used by the first hashed row
const GENESIS_HASH = "0".repeat(64);

// Field order is fixed — changing it invalidates all existing hashes
function computeRowHash(fields: {
  id: string;
  timestamp: string;
  actorId: string | null;
  targetId: string | null;
  action: string;
  ipAddress: string | null;
  prevHash: string;
}): string {
  const payload = JSON.stringify([
    fields.id,
    fields.timestamp,
    fields.actorId,
    fields.targetId,
    fields.action,
    fields.ipAddress,
    fields.prevHash,
  ]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

async function getLastHashForUpdate(tx: DBTransaction): Promise<string> {
  const [last] = await tx
    .select({ rowHash: auditLogs.rowHash })
    .from(auditLogs)
    // Order by the monotonic insertion sequence, not timestamp: two appends in the
    // same millisecond have equal timestamps and `LIMIT 1` could pick the wrong tip,
    // forking the chain. seq (bigserial, assigned under the advisory lock) is unique
    // and strictly increasing, so the true latest row is unambiguous.
    .orderBy(desc(auditLogs.seq))
    .limit(1)
    .for("update");
  // Pre-chain rows have rowHash = '' — treat as genesis
  return last?.rowHash || GENESIS_HASH;
}

export class AuditService {
  static async logActionInternal(tx: DBTransaction, params: LogActionParams) {
    const { actorId, targetId, action, ipAddress } = params;

    // Serialize all appenders so the chain can't fork under concurrency.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);

    const prevHash = await getLastHashForUpdate(tx);
    const id = crypto.randomUUID();
    const timestamp = new Date();

    const rowHash = computeRowHash({
      id,
      timestamp: timestamp.toISOString(),
      actorId: actorId ?? null,
      // Coerce ""→null to MATCH the stored `targetId || null` below. If these
      // disagreed (hashed as "", stored NULL), verifyChainIntegrity would later
      // recompute the hash from the NULL it reads back and raise a false tamper alarm.
      targetId: targetId || null,
      action,
      ipAddress: ipAddress ?? null,
      prevHash,
    });

    return await tx.insert(auditLogs).values({
      id,
      timestamp,
      actorId,
      targetId: targetId || null,
      action,
      ipAddress,
      prevHash,
      rowHash,
    });
  }

  static async logAction(params: LogActionParams) {
    return await db.transaction((tx) => AuditService.logActionInternal(tx, params));
  }

  static async verifyChainIntegrity(): Promise<ChainVerifyResult> {
    // Stream the chain in ordered batches by seq instead of loading the entire
    // (append-only, ever-growing) audit_logs table into memory at once. seq is the
    // monotonic insertion order, so verifying in seq order is deterministic — equal
    // millisecond timestamps can no longer reorder rows and raise a false alarm.
    const BATCH_SIZE = 1000;

    let totalRows = 0;
    let hashedRows = 0;
    let chainStarted = false;
    let expectedPrevHash: string | null = null; // null only for the first hashed row
    let index = -1; // global 0-based row index across all batches
    let cursor = 0; // seq cursor (seq starts at 1, so 0 fetches from the beginning)

    for (;;) {
      const rows = await db
        .select()
        .from(auditLogs)
        .where(gt(auditLogs.seq, cursor))
        .orderBy(asc(auditLogs.seq))
        .limit(BATCH_SIZE);

      if (rows.length === 0) break;

      for (const row of rows) {
        index++;
        totalRows++;
        cursor = row.seq;

        // Skip leading pre-chain rows (rowHash === "") until the chain begins.
        if (!chainStarted) {
          if (row.rowHash === "") continue;
          chainStarted = true;
        }
        hashedRows++;

        if (expectedPrevHash !== null && row.prevHash !== expectedPrevHash) {
          return {
            valid: false,
            totalRows,
            hashedRows,
            firstBreakIndex: index,
            firstBreakId: row.id,
            reason: `Chain break at row ${index} (id: ${row.id}): prevHash mismatch — a row was deleted or inserted before this one.`,
          };
        }

        const recomputed = computeRowHash({
          id: row.id,
          timestamp: row.timestamp!.toISOString(),
          actorId: row.actorId,
          targetId: row.targetId,
          action: row.action,
          ipAddress: row.ipAddress,
          prevHash: row.prevHash,
        });

        if (recomputed !== row.rowHash) {
          return {
            valid: false,
            totalRows,
            hashedRows,
            firstBreakIndex: index,
            firstBreakId: row.id,
            reason: `Chain break at row ${index} (id: ${row.id}): rowHash mismatch — this row's content was modified.`,
          };
        }

        expectedPrevHash = row.rowHash;
      }

      if (rows.length < BATCH_SIZE) break; // last (partial) batch
    }

    if (!chainStarted) {
      return {
        valid: true,
        totalRows,
        hashedRows: 0,
        firstBreakIndex: null,
        firstBreakId: null,
        reason: "No hashed rows yet — chain begins on next log entry.",
      };
    }

    return {
      valid: true,
      totalRows,
      hashedRows,
      firstBreakIndex: null,
      firstBreakId: null,
      reason: `Chain intact across ${hashedRows} hashed rows (${totalRows - hashedRows} pre-chain rows skipped).`,
    };
  }

  static async getLogs(limit = 100, offset = 0) {
    return await db.query.auditLogs.findMany({
      // Newest-first by the monotonic seq (deterministic & stable for pagination —
      // equal-millisecond timestamps could otherwise skip/duplicate rows across pages).
      orderBy: (auditLogs, { desc }) => [desc(auditLogs.seq)],
      limit,
      offset,
      with: {
        actor: {
          columns: { id: true, name: true, email: true, role: true },
        },
        target: {
          columns: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  /**
   * One page of audit logs (newest first by timestamp) with actor/target, plus
   * the total row count, for the admin audit-log viewer.
   */
  static async listLogsPage(page: number, pageSize: number) {
    const [logs, total] = await Promise.all([
      db.query.auditLogs.findMany({
        with: {
          actor: { columns: { id: true, name: true, role: true } },
          target: { columns: { id: true, studentId: true, name: true } },
        },
        orderBy: (auditLogs, { desc }) => [desc(auditLogs.timestamp)],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      db.$count(auditLogs),
    ]);
    return { logs, total };
  }
}
