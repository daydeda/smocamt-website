import { db } from "@/db";
import { houses, scoreHistory, users } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { COLORS, DEFAULT_FACULTY, normalizeFaculty } from "@/lib/faculties";

// Transaction-scoped advisory lock key serializing concurrent house assignments
// (student onboarding AND staff-bypass provisioning) so two new members can't both
// read the same least-full house and pile into it. Shared by both code paths
// (imported by src/app/api/profile/route.ts and src/modules/users/users.service.ts)
// so they serialize against each other, not just within their own path. Distinct
// from the audit and award lock keys.
export const HOUSE_BALANCE_LOCK_KEY = 824517;

// Either the base db handle or a transaction — both expose the .query API that
// pickBalancedHouseId needs, so the caller can run the count + the new student's
// house assignment under a single advisory lock.
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class HousesService {
  /**
   * Picks the house a new STUDENT should join for balanced distribution (FE-03):
   * the house with the fewest members right now (counting everyone). Ties resolve
   * to the first such house by query order. Used by the onboarding profile submit.
   *
   * Staff are balanced separately — see pickBalancedHouseIdForStaff — so that the
   * (much larger) student population doesn't skew where staff land.
   *
   * Returns the house id, or null if no houses exist yet (caller leaves houseId
   * unset rather than crashing).
   */
  static async pickBalancedHouseId(executor: DbOrTx = db): Promise<string | null> {
    const housesList = await executor.query.houses.findMany({ columns: { id: true } });
    if (housesList.length === 0) return null;

    // Count ALL members per house in SQL (GROUP BY) instead of loading the whole
    // users table and counting in JS — the old shape was O(n) memory + work inside
    // the onboarding advisory lock. Houses with zero members don't appear in these
    // rows, so default them to 0 when ranking below.
    const memberCounts = await executor
      .select({ houseId: users.houseId, count: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.houseId);

    const countByHouse = new Map(memberCounts.map((r) => [r.houseId, r.count]));
    const sorted = [...housesList].sort(
      (a, b) => (countByHouse.get(a.id) ?? 0) - (countByHouse.get(b.id) ?? 0),
    );
    return sorted[0].id;
  }

  /**
   * Picks the colour house a student should join WITHIN their faculty: the
   * faculty house (one of 4 colours) with the fewest members right now. Ties
   * resolve to the first such house by query order. Called at onboarding
   * completion (POST /api/profile) under HOUSE_BALANCE_LOCK_KEY, passing that
   * transaction as `executor` so the count + write are serialized against
   * concurrent onboardings. ScannerService.ensureHouseAssigned also calls this
   * (without a tx) as a fallback safety net for any student who still has no
   * house at check-in time.
   *
   * `faculty` is normalised to CAMT when null/unknown for back-compat. Returns
   * the house id, or null if that faculty has no houses seeded yet.
   */
  static async pickBalancedHouseIdForFaculty(
    faculty: string | null | undefined,
    executor: DbOrTx = db,
  ): Promise<string | null> {
    const fac = normalizeFaculty(faculty);
    const housesList = await executor.query.houses.findMany({
      where: eq(houses.faculty, fac),
      with: { users: { columns: { id: true } } },
    });
    if (housesList.length === 0) return null;
    const sorted = [...housesList].sort((a, b) => a.users.length - b.users.length);
    return sorted[0].id;
  }

  /**
   * Picks the house a new STAFF member should join for balanced staff
   * distribution: the house with the fewest `staff`-role members right now,
   * counting ONLY staff (students are ignored). Ties resolve to the first such
   * house by query order. Used by the staff onboarding-bypass provisioning so
   * staff spread evenly across houses independently of the student population.
   *
   * Returns the house id, or null if no houses exist yet (caller leaves houseId
   * unset rather than crashing).
   */
  static async pickBalancedHouseIdForStaff(
    faculty: string | null | undefined = DEFAULT_FACULTY,
    executor: DbOrTx = db,
  ): Promise<string | null> {
    const fac = normalizeFaculty(faculty);
    // Scope to the staff member's faculty so staff land in one of their own
    // faculty's 4 colour houses (not spread across all 16).
    const housesList = await executor.query.houses.findMany({
      where: eq(houses.faculty, fac),
      columns: { id: true },
    });
    if (housesList.length === 0) return null;
    const houseIds = housesList.map((h) => h.id);

    // Count only staff-role members per house, within this faculty. Houses with
    // zero staff don't appear in these rows, so default them to 0 when ranking.
    const staffCounts = await executor
      .select({ houseId: users.houseId, count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, "staff"), inArray(users.houseId, houseIds)))
      .groupBy(users.houseId);

    const countByHouse = new Map(staffCounts.map((r) => [r.houseId, r.count]));
    const sorted = [...housesList].sort(
      (a, b) => (countByHouse.get(a.id) ?? 0) - (countByHouse.get(b.id) ?? 0),
    );
    return sorted[0].id;
  }

  /**
   * Adjusts house points atomically inside a database transaction,
   * inserts a record into score history, and writes an audit log.
   */
  static async adjustHousePoints(params: {
    houseId: string;
    delta: number;
    reason: string;
    actorId?: string;
    ipAddress?: string;
    eventId?: string;
  }) {
    const { houseId, delta, reason, actorId, ipAddress, eventId } = params;

    const result = await db.transaction(async (tx) => {
      // 1. Update house points atomically
      await tx
        .update(houses)
        .set({
          points: sql`${houses.points} + ${delta}`,
        })
        .where(eq(houses.id, houseId));

      // 2. Log score history
      const [historyRecord] = await tx
        .insert(scoreHistory)
        .values({
          houseId,
          delta,
          reason,
          eventId: eventId || null,
          timestamp: new Date(),
        })
        .returning();

      // 3. Write Audit Log (decoupled call to AuditService)
      if (actorId) {
        await AuditService.logActionInternal(tx, {
          actorId,
          action: `Adjusted house ${houseId} points by ${delta}. Reason: ${reason}`,
          ipAddress: ipAddress || "127.0.0.1",
        });
      }

      return { historyRecord };
    });

    return result?.historyRecord;
  }

  /**
   * Public leaderboard: the 4 colour houses, sorted high→low by points.
   * ActiveCAMT is CAMT-only, so this is a 1:1 read today, not a rollup — kept
   * grouped by colorGroup for parity with getFacultyBreakdown below.
   */
  static async getLeaderboard() {
    const rows = await db
      .select({
        colorGroup: houses.colorGroup,
        points: sql<number>`sum(${houses.points})::int`,
      })
      .from(houses)
      .groupBy(houses.colorGroup);

    const pointsByColor = new Map(rows.map((r) => [r.colorGroup, r.points]));
    return COLORS.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      points: pointsByColor.get(c.id) ?? 0,
    })).sort((a, b) => b.points - a.points);
  }

  /**
   * The house row(s) for a single colour group. ActiveCAMT is CAMT-only, so
   * this returns exactly one row today; kept plural-shaped so the colour
   * house detail view doesn't need to special-case a single-faculty result.
   */
  static async getFacultyBreakdown(colorGroup: string) {
    return await db.query.houses.findMany({
      where: eq(houses.colorGroup, colorGroup),
      orderBy: (houses, { desc }) => [desc(houses.points)],
    });
  }

  /**
   * Fetch recent score history logs
   */
  static async getRecentActivity(limit = 50) {
    return await db.query.scoreHistory.findMany({
      orderBy: (scoreHistory, { desc }) => [desc(scoreHistory.timestamp)],
      limit,
      with: {
        house: true,
        event: true,
      },
    });
  }
}
