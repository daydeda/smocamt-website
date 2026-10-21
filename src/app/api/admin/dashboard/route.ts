import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, events, users, houses } from "@/db/schema";
import { count, sql, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { csvCell } from "@/lib/util/csv";
import { unstable_cache } from "next/cache";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { captureException, logger } from "@/lib/util/logger";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

// Hard ceiling: a request must never hang at the platform's 300s default. If a DB
// call stalls (e.g. the Supabase pooler is momentarily queueing), fail fast at 20s,
// release the connection, and let the client's next poll retry — instead of holding
// a zombie function (and its pooled connection) for 5 minutes.
export const maxDuration = 20;

// Application-level deadline, deliberately shorter than maxDuration. If the DB work
// can't finish in time (almost always a connection that's waiting on the Supabase
// pooler rather than a genuinely slow query — the DB is tiny), we return a fast 503
// and let the client's poll retry, instead of holding the function (and its pooled
// connection) hostage until the platform 504s it at 20s. The orphaned query settles
// on its own later; the process-level unhandledRejection guard in src/db keeps a
// late rejection from crashing the instance.
const READ_TIMEOUT_MS = 8000;

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// The expensive dashboard aggregates, cached at the app layer for 15s so polling
// admins don't each hit the DB (this is the workload that previously starved the
// pooler). Both are GLOBAL (identical for every admin), so a single shared cache
// entry is correct. Dates are computed inside so each 15s fill re-anchors "today"
// and the 30-day window itself.
const getDashboardCounts = unstable_cache(
  async () => {
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
  },
  ["admin-dashboard-counts"],
  { revalidate: 15, tags: ["admin-dashboard-counts"] },
);

const getHouseMemberCounts = unstable_cache(
  async () =>
    db
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
      .groupBy(houses.id),
  ["admin-dashboard-house-members"],
  { revalidate: 15, tags: ["admin-dashboard-house-members"] },
);


export async function GET(req: Request) {
  try {
    const session = await withTimeout(auth(), READ_TIMEOUT_MS, "auth");
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    const globalReg = isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    const isAdminRole = ["super_admin", "admin", "registration", "organizer"].includes(session?.user?.role || "") || globalReg;
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }


    const type = new URL(req.url).searchParams.get("type") || "overview";

    if (type === "csv") {
      // FE-11: CSV Export
      if (!["super_admin", "admin", "registration"].includes(session.user.role || "") && !globalReg) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // Bulk PII export: keep a tamper-evident record of who pulled it (PDPA). Count
      // first (one cheap aggregate) so the audit row has the row count without
      // materializing the whole table.
      const [{ total }] = await db.select({ total: count() }).from(attendance);
      await AuditService.logAction({
        actorId: session.user.id!,
        action: `Exported full attendance CSV (${Number(total)} rows)`,
        ipAddress: getClientIp(req),
      });

      // Stream the rows in batches instead of loading the entire (forever-growing)
      // attendance table + the whole CSV string into memory. Memory stays bounded to
      // one batch; the client receives bytes as they're produced.
      const encoder = new TextEncoder();
      const BATCH = 1000;
      const header = "Event_Title,Student_ID,Name,Major,Check_In_Time,Method\n";
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("\ufeff" + header)); // BOM + header
        },
        async pull(controller) {
          try {
            const batch = await db.query.attendance.findMany({
              with: {
                user: { columns: { studentId: true, name: true, major: true } },
                event: { columns: { title: true } },
              },
              orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
              limit: BATCH,
              offset,
            });
            if (batch.length === 0) {
              controller.close();
              return;
            }
            offset += batch.length;
            let chunk = "";
            for (const a of batch) {
              chunk += [a.event?.title, a.user?.studentId, a.user?.name, a.user?.major, a.checkInTime, a.method]
                .map(csvCell)
                .join(",") + "\n";
            }
            controller.enqueue(encoder.encode(chunk));
            if (batch.length < BATCH) controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="activecamt_attendance_${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    // NOTE: event-winner awarding is intentionally NOT done here. This is the
    // highest-frequency polled endpoint; doing transactional write work in its
    // request path previously held pooled DB connections long enough to starve the
    // Supabase pooler and 504 the whole site. Awarding now lives in its own
    // endpoint (/api/admin/award-check), pinged fire-and-forget by the client, and
    // in the daily cron. This route is a pure, fast read.

    // Default: Overview stats. The expensive, every-10s-polled aggregates (4 counts +
    // the house member GROUP BY) are cached at the app layer for 15s so DB cost is
    // decoupled from how many admins are polling — the workload that used to starve
    // the pooler. Recent activity below stays live (cheap, limit 10). Check-ins-today
    // is anchored to Bangkok midnight inside getDashboardCounts (UTC+7, no DST).
    const { totalUsers, totalEvents, checkinsToday, newUsers30d } = await withTimeout(
      getDashboardCounts(),
      READ_TIMEOUT_MS,
      "counts"
    );
    // Growth = new arrivals / what existed before the window. If there's no prior
    // base (brand-new platform — everyone registered within the window), growth %
    // is meaningless, so return 0 and let the card hide the badge until a real
    // baseline exists (students older than 30 days to compare against).
    const priorUsers = totalUsers - newUsers30d;
    const userGrowthPct = priorUsers > 0 ? Math.round((newUsers30d / priorUsers) * 100) : 0;

    const houseListWithMembers = await withTimeout(
      getHouseMemberCounts(),
      READ_TIMEOUT_MS,
      "houses"
    );

    const recentCheckins = await withTimeout(
      db.query.attendance.findMany({
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
      }),
      READ_TIMEOUT_MS,
      "checkins"
    );

    const recentScores = await withTimeout(
      db.query.scoreHistory.findMany({
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
      }),
      READ_TIMEOUT_MS,
      "scores"
    );

    // Merge and sort
    const mergedActivity = [
      ...recentCheckins.map(a => ({
        type: "checkin" as const,
        studentName: a.user?.name ?? "Unknown",
        studentNickname: a.user?.nickname ?? "",
        eventTitle: a.event?.title ?? "Unknown Event",
        timestamp: a.checkInTime?.toISOString() || new Date().toISOString(),
      })),
      ...recentScores.map(s => ({
        type: "score" as const,
        houseId: s.house?.id,
        houseName: s.house?.name ?? "Unknown",
        houseColor: s.house?.color ?? "var(--accent-primary)",
        delta: s.delta,
        reason: s.reason,
        timestamp: s.timestamp?.toISOString() || new Date().toISOString(),
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);

    return NextResponse.json({
      totalUsers,
      totalEvents,
      checkinsToday,
      userGrowthPct,
      recentActivity: mergedActivity,
      houses: houseListWithMembers.map((h) => ({
        id: h.id,
        name: h.name,
        color: h.color,
        points: h.points ?? 0,
        faculty: h.faculty,
        colorGroup: h.colorGroup,
        members: Number(h.members) ?? 0,
      })),
    });
  } catch (error) {
    // A deadline miss is a transient pooler/connection stall, not a real error.
    // Return 503 so the client's next poll retries quickly, and tell it when.
    if (error instanceof TimeoutError) {
      // Transient pooler/connection stall — log at warn, don't alert.
      logger.warn("dashboard read timed out; returning 503", { message: error.message });
      return NextResponse.json(
        { error: "Service busy, retrying shortly" },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    captureException(error, { route: "GET /api/admin/dashboard" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
