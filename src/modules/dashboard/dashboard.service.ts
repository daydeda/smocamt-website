import { db } from "@/db";
import { attendance, events, users, houses } from "@/db/schema";
import { count, sql, eq } from "drizzle-orm";

export class DashboardService {
  /**
   * The four global overview counts. Dates are computed inside so each cache
   * fill re-anchors "today" and the 30-day window itself.
   */
  static async getOverviewCounts() {
    const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
    const bkkNow = new Date(Date.now() + BKK_OFFSET_MS);
    bkkNow.setUTCHours(0, 0, 0, 0);
    const startOfToday = new Date(bkkNow.getTime() - BKK_OFFSET_MS);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const countsResult = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM ${users}) AS "totalUsers",
        (SELECT count(*)::int FROM ${events}) AS "totalEvents",
        (SELECT count(*)::int FROM ${attendance} WHERE ${attendance.checkInTime} >= ${startOfToday.toISOString()}) AS "checkinsToday",
        (SELECT count(*)::int FROM ${users} WHERE ${users.createdAt} >= ${thirtyDaysAgo.toISOString()}) AS "newUsers30d"
    `);
    return {
      totalUsers: (countsResult[0]?.totalUsers as number) ?? 0,
      totalEvents: (countsResult[0]?.totalEvents as number) ?? 0,
      checkinsToday: (countsResult[0]?.checkinsToday as number) ?? 0,
      newUsers30d: (countsResult[0]?.newUsers30d as number) ?? 0,
    };
  }

  /** Every house with its member count (GROUP BY in SQL). */
  static async getHouseMemberCounts() {
    return db
      .select({
        id: houses.id,
        name: houses.name,
        color: houses.color,
        points: houses.points,
        faculty: houses.faculty,
        colorGroup: houses.colorGroup,
        members: count(users.id),
      })
      .from(houses)
      .leftJoin(users, eq(users.houseId, houses.id))
      .groupBy(houses.id);
  }

  /** Total number of attendance rows (cheap aggregate for the CSV export audit row). */
  static async countAttendanceRows() {
    const [{ total }] = await db.select({ total: count() }).from(attendance);
    return total;
  }

  /** One batch of attendance rows (newest first) for the streamed CSV export. */
  static async getAttendanceExportBatch(limit: number, offset: number) {
    return db.query.attendance.findMany({
      with: {
        user: { columns: { studentId: true, name: true, major: true } },
        event: { columns: { title: true } },
      },
      orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
      limit,
      offset,
    });
  }

  /** The 10 most recent genuine check-ins for the Recent Activity feed. */
  static async getRecentCheckins() {
    return db.query.attendance.findMany({
      limit: 10,
      // Only genuine check-ins. Registration rows have checkInTime = null, and
      // `ORDER BY ... DESC` is NULLS FIRST in Postgres, so without this filter
      // those un-checked-in rows sort to the top and fall back to new Date()
      // below — making every Recent Activity entry show the current time.
      where: (attendance, { isNotNull }) => isNotNull(attendance.checkInTime),
      orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
      with: {
        user: { columns: { name: true, nickname: true } },
        event: { columns: { title: true } },
      },
    });
  }

  /** The 10 most recent house score changes for the Recent Activity feed. */
  static async getRecentScores() {
    return db.query.scoreHistory.findMany({
      limit: 10,
      orderBy: (scoreHistory, { desc }) => [desc(scoreHistory.timestamp)],
      columns: {
        id: true,
        delta: true,
        reason: true,
        timestamp: true,
      },
      with: {
        house: { columns: { id: true, name: true, color: true } },
      },
    });
  }
}
