import { db } from "@/db";
import { attendance, events, eventSessions, forms } from "@/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";

export class EventsService {
  /**
   * Retrieves an event record by UUID
   */
  static async getEventById(id: string) {
    return await db.query.events.findFirst({
      where: eq(events.id, id),
    });
  }

  /**
   * Lists an event's sessions in display order ("Day 1", "Day 2", …).
   */
  static async getSessions(eventId: string) {
    return await db.query.eventSessions.findMany({
      where: eq(eventSessions.eventId, eventId),
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.startTime)],
    });
  }

  /**
   * Resolve which session a scan defaults to when the client omits sessionId.
   * Prefers the session whose [start, end] window contains now; else the nearest
   * upcoming; else the most recent past. Deterministic so the scanner UI and the
   * server pick the same "current" day. Returns null if the event has no sessions.
   */
  static async resolveCurrentSessionId(eventId: string): Promise<string | null> {
    const sessions = await this.getSessions(eventId);
    if (sessions.length === 0) return null;
    const now = Date.now();
    const current = sessions.find(
      (s) => s.startTime.getTime() <= now && now <= s.endTime.getTime()
    );
    if (current) return current.id;
    const upcoming = sessions.find((s) => s.startTime.getTime() > now);
    if (upcoming) return upcoming.id;
    return sessions[sessions.length - 1].id; // all in the past → most recent
  }

  /**
   * General list of events
   */
  static async getEventsList() {
    return await db.query.events.findMany({
      orderBy: (events, { desc }) => [desc(events.startTime)],
    });
  }

  /**
   * Everything a club/major president has submitted that awaits staff review:
   * pending Feedback Forms and pending event detail edits (admin reviews page).
   */
  static async listPendingReviewItems() {
    const pendingForms = await db.query.forms.findMany({
      where: eq(forms.reviewStatus, "pending"),
      orderBy: (f, { desc }) => [desc(f.updatedAt)],
      with: {
        event: { columns: { id: true, title: true } },
      },
    });

    const pendingEventsRaw = await db.query.events.findMany({
      // Requires an actual pendingDetailsChanges diff, not just the status flag —
      // a stale/defaulted 'pending' status with no diff (e.g. a pre-existing event
      // backfilled by the details_review_status column's DEFAULT 'pending', see
      // drizzle/0030_backfill_details_review_status.sql) has nothing to review.
      where: and(eq(events.detailsReviewStatus, "pending"), isNotNull(events.pendingDetailsChanges)),
      columns: {
        id: true,
        title: true,
        startTime: true,
        ownerClubIds: true,
        ownerMajors: true,
        updatedAt: true,
      },
    });
    // Only genuinely president-owned events — a plain staff-created event
    // defaults to 'pending' too (see events.detailsReviewStatus in schema.ts)
    // but was never edited by a president and has nothing here to review.
    const pendingEvents = pendingEventsRaw.filter(
      (e) => (e.ownerClubIds && e.ownerClubIds.length > 0) || (e.ownerMajors && e.ownerMajors.length > 0)
    );

    return { pendingForms, pendingEvents };
  }

  /** The owner club/major lists of an event, for president-scope access checks. */
  static async getEventOwnership(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { ownerClubIds: true, ownerMajors: true },
    });
  }

  /**
   * Registered seat counts per event — DISTINCT students holding a seat, which is
   * exactly the headcount the register route enforces quota against. Staff rows
   * don't count toward the displayed "X / quota" headcount.
   */
  static async getSeatCounts() {
    return db
      .select({
        eventId: attendance.eventId,
        value: sql<number>`count(distinct ${attendance.studentId})`,
      })
      .from(attendance)
      // Staff rows don't count toward the displayed "X / quota" headcount —
      // mirrors the quota exemption in register/route.ts, scanner.service.ts,
      // and the admin list's getAttendeeCounts. Without this filter, staff
      // registering for their own event inflated the numerator past quota
      // (e.g. showing "17/16") even though the quota check itself already
      // excludes them.
      .where(eq(attendance.isStaff, false))
      .groupBy(attendance.eventId);
  }

  /** Every event, soonest start first (student-facing feed). */
  static async listAllByStartTime() {
    return db.query.events.findMany({
      orderBy: (events, { asc }) => [asc(events.startTime)],
    });
  }
}
