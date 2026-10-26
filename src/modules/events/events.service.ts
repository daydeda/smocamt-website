import { db } from "@/db";
import { attendance, events, eventSessions, forms, users } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { bangkokDateKey } from "@/lib/events/event-schema";
import { isEligibleFor, isEligibleForGuest, type Viewer } from "@/lib/access/event-access";
import { normalizeShortSlug } from "@/lib/events/event-slug";
import { toPublicEvent, type PublicEvent } from "@/lib/events/public-event";
import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";

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

  /**
   * One event for the logged-out public page (/e/[id]). Returns null when the
   * event is missing OR not open to guests, so restricted events never leak.
   */
  /**
   * Validates an owner-typed link name and checks nobody else uses it. `slug` is
   * the normalised value to store (null clears it).
   */
  static async prepareShortSlug(
    input: string | null,
    exceptId?: string,
  ): Promise<{ ok: true; slug: string | null } | { ok: false; status: 400 | 409; error: string }> {
    const r = normalizeShortSlug(input);
    if (!r.ok) {
      return {
        ok: false,
        status: 400,
        error: r.reason === "reserved"
          ? "That link name is reserved. Please choose another."
          : "Link name must be 3 to 40 characters: lowercase letters, numbers and single hyphens.",
      };
    }
    if (r.slug && (await this.isShortSlugTaken(r.slug, exceptId))) {
      return { ok: false, status: 409, error: "That link name is already used by another event." };
    }
    return { ok: true, slug: r.slug };
  }

  /** Event id for an owner-chosen link name, or null. */
  static async findIdByShortSlug(slug: string): Promise<string | null> {
    const [row] = await db.select({ id: events.id }).from(events).where(eq(events.shortSlug, slug)).limit(1);
    return row?.id ?? null;
  }

  /** Whether another event (not `exceptId`) already uses this link name. */
  static async isShortSlugTaken(slug: string, exceptId?: string): Promise<boolean> {
    const id = await this.findIdByShortSlug(slug);
    return id !== null && id !== exceptId;
  }

  /** Resolves the 8-hex id prefix from a short /e/ link; null unless it matches exactly one event. */
  static async resolveIdByPrefix(prefix: string): Promise<string | null> {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(sql`${events.id}::text like ${prefix + "%"}`)
      .limit(2);
    return rows.length === 1 ? rows[0].id : null;
  }

  static async getPublicEvent(id: string, viewer?: Viewer): Promise<PublicEvent | null> {
    const event = await db.query.events.findFirst({ where: eq(events.id, id) });
    if (!event) return null;
    // A signed-in viewer is judged by their own roles/major/clubs, so an event
    // restricted to e.g. SMO still opens for them; guests keep the guest predicate.
    if (!(viewer ? isEligibleFor(event, viewer) : isEligibleForGuest(event))) return null;
    const [seat] = await db
      .select({ value: sql<number>`count(distinct ${attendance.studentId})` })
      .from(attendance)
      .where(and(eq(attendance.eventId, id), eq(attendance.isStaff, false)));
    return toPublicEvent(event, Number(seat?.value ?? 0));
  }

  /**
   * Upcoming events open to logged-out visitors, soonest first, for the public home
   * page. Filters by the same guest predicate as /api/events, then takes `limit`.
   */
  static async listUpcomingPublic(limit: number, now: Date = new Date()): Promise<PublicEvent[]> {
    const rows = await db.query.events.findMany({
      where: gt(events.endTime, now),
      orderBy: (events, { asc }) => [asc(events.startTime)],
    });
    const eligible = rows.filter((e) => isEligibleForGuest(e)).slice(0, limit);
    const seats = await this.getSeatCounts();
    const seatById = new Map(seats.map((c) => [c.eventId, Number(c.value)]));
    return eligible.map((e) => toPublicEvent(e, seatById.get(e.id) ?? 0));
  }

  /** Every event, soonest start first (student-facing feed). */
  static async listAllByStartTime() {
    return db.query.events.findMany({
      orderBy: (events, { asc }) => [asc(events.startTime)],
    });
  }

  /**
   * Starts a not-yet-started event early ("Go live now"): moves the event's
   * start AND its first session's start to `now`, plus the audit log, in one
   * transaction. Throws Error("EVENT_NOT_FOUND" | "ALREADY_STARTED" | "NOT_TODAY").
   */
  static async goLiveNow(id: string, now: Date, actorId: string, ipAddress: string) {
    return db.transaction(async (tx) => {
      const current = await tx.query.events.findFirst({ where: eq(events.id, id) });
      if (!current) throw new Error("EVENT_NOT_FOUND");
      // Re-checked inside the transaction so two staff tapping at once can't
      // both "start" it — the second one sees it already started.
      if (current.startTime.getTime() <= now.getTime()) throw new Error("ALREADY_STARTED");
      if (bangkokDateKey(current.startTime.toISOString()) !== bangkokDateKey(now.toISOString())) {
        throw new Error("NOT_TODAY");
      }

      const sessions = await tx
        .select()
        .from(eventSessions)
        .where(eq(eventSessions.eventId, id))
        .orderBy(asc(eventSessions.sortOrder), asc(eventSessions.startTime));
      const first = sessions[0];
      if (first && first.startTime.getTime() > now.getTime()) {
        if (bangkokDateKey(first.startTime.toISOString()) !== bangkokDateKey(now.toISOString())) {
          throw new Error("NOT_TODAY");
        }
        await tx
          .update(eventSessions)
          .set({ startTime: now, updatedAt: now })
          .where(eq(eventSessions.id, first.id));
        first.startTime = now;
      }

      const [row] = await tx
        .update(events)
        .set({ startTime: now, updatedAt: now })
        .where(eq(events.id, id))
        .returning();

      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        action: `Started event early (Go live now): ${row.title} (${id}) — start moved from ${current.startTime.toISOString()} to ${now.toISOString()}`,
        ipAddress,
      });

      return { event: row, sessions };
    });
  }

  /** email + name of the given staff users (Songsue event mirror payload). */
  static async listStaffContacts(staffUserIds: string[]) {
    return db.select({ email: users.email, name: users.name }).from(users).where(inArray(users.id, staffUserIds));
  }

  /** The event columns the attendance report needs (title + management/ownership scope). */
  static async getEventForReport(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, title: true, managedByRoles: true, ownerClubIds: true, ownerMajors: true },
    });
  }

  /** Sessions of an event (id/title/sortOrder only) in display order. */
  static async listSessionsBrief(eventId: string) {
    return db.query.eventSessions.findMany({
      where: eq(eventSessions.eventId, eventId),
      columns: { id: true, title: true, sortOrder: true },
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.startTime)],
    });
  }

  /** An event's title only. */
  static async getEventTitle(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { title: true },
    });
  }

  /** An event's id + title only. */
  static async getEventIdAndTitle(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, title: true },
    });
  }

  /** The event columns the attendee export needs (title, management scope, staff list, check-out flag). */
  static async getEventForExport(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, title: true, managedByRoles: true, ownerClubIds: true, ownerMajors: true, staffUserIds: true, requireCheckOut: true },
    });
  }

  /** One session's title + sortOrder, only if it belongs to the event. */
  static async getSessionTitleOrder(sessionId: string, eventId: string) {
    return db.query.eventSessions.findFirst({
      where: and(eq(eventSessions.id, sessionId), eq(eventSessions.eventId, eventId)),
      columns: { title: true, sortOrder: true },
    });
  }

  /** An event's id + owner club/major lists (president-scope check). */
  static async getEventIdAndOwnership(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, ownerClubIds: true, ownerMajors: true },
    });
  }
}
