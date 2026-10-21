import { randomBytes } from "crypto";
import { db } from "@/db";
import { attendance, calendarEntries, calendarFeedTokens, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AuditService } from "@/modules/audit/audit.service";
import {
  type Viewer,
  isEligibleFor,
  isEligibleForGuest,
} from "@/lib/access/event-access";

// Unified calendar item shape returned to the grid and used to build .ics /
// "add to calendar" links. `kind` lets the UI style + route the two sources:
//   - "event": a real activity from the events table (also on the dashboard)
//   - "entry": a calendar-only annotation (never on the dashboard)
export interface CalendarItem {
  id: string;
  kind: "event" | "entry";
  title: string;
  description: string | null;
  location: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
  allDay: boolean;
  /** For an entry, the optional linked event id; for an event, always null. */
  eventId: string | null;
  /** Event cover poster (imageUrls[0] ?? imageUrl). Always null for entries. */
  imageUrl: string | null;
  updatedAt: string | null;
  // Visibility — surfaced so the manager edit form can prefill without a reset.
  // Not sensitive (events already expose these via /api/events).
  allowedRoles: string[] | null;
  allowedMajors: string[] | null;
  targetThai: boolean;
  targetInternational: boolean;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrenceUntil: string | null; // ISO, null when no end date
}

type EventRow = typeof import("@/db/schema").events.$inferSelect;
type EntryRow = typeof import("@/db/schema").calendarEntries.$inferSelect;

function mapEvent(e: EventRow): CalendarItem {
  return {
    id: e.id,
    kind: "event",
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime.toISOString(),
    allDay: false,
    eventId: null,
    imageUrl: e.imageUrls?.[0] ?? e.imageUrl ?? null,
    updatedAt: e.updatedAt ? e.updatedAt.toISOString() : null,
    allowedRoles: e.allowedRoles ?? null,
    allowedMajors: e.allowedMajors ?? null,
    targetThai: e.targetThai ?? true,
    targetInternational: e.targetInternational ?? true,
    recurrence: "none",
    recurrenceUntil: null,
  };
}

function mapEntry(e: EntryRow): CalendarItem {
  return {
    id: e.id,
    kind: "entry",
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime.toISOString(),
    allDay: e.allDay,
    eventId: e.eventId ?? null,
    imageUrl: null,
    updatedAt: e.updatedAt ? e.updatedAt.toISOString() : null,
    allowedRoles: e.allowedRoles ?? null,
    allowedMajors: e.allowedMajors ?? null,
    targetThai: e.targetThai ?? true,
    targetInternational: e.targetInternational ?? true,
    recurrence: (e.recurrence as "none" | "daily" | "weekly" | "monthly") ?? "none",
    recurrenceUntil: e.recurrenceUntil ? e.recurrenceUntil.toISOString() : null,
  };
}

async function loadRows() {
  return Promise.all([
    db.query.events.findMany({ orderBy: (e, { asc }) => [asc(e.startTime)] }),
    db.query.calendarEntries.findMany({ orderBy: (e, { asc }) => [asc(e.startTime)] }),
  ]);
}

/**
 * Calendar items visible to an authenticated viewer. Events the user is
 * registered for / checked into are always surfaced (same attendance bypass as
 * /api/events), even if eligibility would otherwise hide them.
 */
export async function getCalendarItemsForViewer(
  viewer: Viewer,
  userId: string
): Promise<CalendarItem[]> {
  const [[allEvents, allEntries], atts] = await Promise.all([
    loadRows(),
    db.query.attendance.findMany({
      where: eq(attendance.studentId, userId),
      columns: { eventId: true },
    }),
  ]);

  const attended = new Set(atts.map((a) => a.eventId));
  const events = allEvents
    .filter((e) => attended.has(e.id) || isEligibleFor(e, viewer))
    .map(mapEvent);
  const entries = allEntries
    .filter((e) => isEligibleFor(e, viewer))
    .map(mapEntry);
  return [...events, ...entries];
}

/** Calendar items visible to an unauthenticated guest (parity with /api/events). */
export async function getCalendarItemsForGuest(): Promise<CalendarItem[]> {
  const [allEvents, allEntries] = await loadRows();
  const events = allEvents.filter((e) => isEligibleForGuest(e)).map(mapEvent);
  const entries = allEntries.filter((e) => isEligibleForGuest(e)).map(mapEntry);
  return [...events, ...entries];
}

// 256-bit unguessable secret — the bearer credential for the .ics feed URL.
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type CalendarEntryInput = {
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  eventId?: string | null;
  allowedRoles?: string[] | null;
  allowedMajors?: string[] | null;
  targetThai?: boolean;
  targetInternational?: boolean;
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  recurrenceUntil?: string | null;
};

export type CalendarEntryUpdateInput = Partial<CalendarEntryInput>;

export class CalendarService {
  /** Creates a calendar entry and its audit log in one transaction. */
  static async createEntry(data: CalendarEntryInput, actorId: string, ipAddress: string) {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(calendarEntries)
        .values({
          title: data.title,
          description: data.description ?? null,
          location: data.location ?? null,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          allDay: data.allDay ?? false,
          eventId: data.eventId ?? null,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          recurrence: data.recurrence ?? "none",
          recurrenceUntil: data.recurrenceUntil ? new Date(data.recurrenceUntil) : null,
          createdBy: actorId,
        })
        .returning();

      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Created Calendar Entry: ${created.title}`,
        ipAddress,
      });

      return created;
    });
  }

  /**
   * Updates a calendar entry and writes its audit log in one transaction.
   * Throws Error("ENTRY_NOT_FOUND") when no row matches the id.
   */
  static async updateEntry(id: string, data: CalendarEntryUpdateInput, actorId: string, ipAddress: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(calendarEntries)
        .set({
          ...(data.title && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.location !== undefined && { location: data.location }),
          ...(data.startTime && { startTime: new Date(data.startTime) }),
          ...(data.endTime && { endTime: new Date(data.endTime) }),
          ...(data.allDay !== undefined && { allDay: data.allDay }),
          ...(data.eventId !== undefined && { eventId: data.eventId }),
          ...(data.allowedRoles !== undefined && {
            allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          }),
          ...(data.allowedMajors !== undefined && {
            allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          }),
          ...(data.targetThai !== undefined && { targetThai: data.targetThai }),
          ...(data.targetInternational !== undefined && { targetInternational: data.targetInternational }),
          ...(data.recurrence !== undefined && { recurrence: data.recurrence }),
          ...(data.recurrenceUntil !== undefined && {
            recurrenceUntil: data.recurrenceUntil ? new Date(data.recurrenceUntil) : null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(calendarEntries.id, id))
        .returning();

      if (!row) throw new Error("ENTRY_NOT_FOUND");

      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Updated Calendar Entry: ${row.title}`,
        ipAddress,
      });

      return row;
    });
  }

  /**
   * Deletes a calendar entry and writes its audit log in one transaction.
   * Throws Error("ENTRY_NOT_FOUND") when no row matches the id.
   */
  static async deleteEntry(id: string, actorId: string, ipAddress: string) {
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(calendarEntries)
        .where(eq(calendarEntries.id, id))
        .returning({ id: calendarEntries.id, title: calendarEntries.title });

      if (!deleted) throw new Error("ENTRY_NOT_FOUND");

      await AuditService.logActionInternal(tx, {
        actorId,
        action: `Deleted Calendar Entry: ${deleted.title}`,
        ipAddress,
      });
    });
  }

  /**
   * The caller's feed token, lazily created on first request so the Subscribe
   * panel always has a URL to show. Null if it still can't be read back.
   */
  static async getOrCreateFeedToken(userId: string) {
    let row = await db.query.calendarFeedTokens.findFirst({
      where: eq(calendarFeedTokens.userId, userId),
    });
    if (!row) {
      await db
        .insert(calendarFeedTokens)
        .values({ userId, token: newToken() })
        .onConflictDoNothing();
      row = await db.query.calendarFeedTokens.findFirst({
        where: eq(calendarFeedTokens.userId, userId),
      });
    }
    return row?.token ?? null;
  }

  /** Rotate: issue a new token, instantly killing the old subscribe URL. */
  static async rotateFeedToken(userId: string) {
    const token = newToken();

    const [row] = await db
      .insert(calendarFeedTokens)
      .values({ userId, token })
      .onConflictDoUpdate({
        target: calendarFeedTokens.userId,
        set: { token, createdAt: new Date(), lastUsedAt: null },
      })
      .returning();
    return row.token;
  }

  /** Revoke the feed token entirely (no active feed afterwards). */
  static async revokeFeedToken(userId: string) {
    await db
      .delete(calendarFeedTokens)
      .where(eq(calendarFeedTokens.userId, userId));
  }

  /** Looks up a feed token row by its secret value. */
  static async findFeedTokenRow(token: string) {
    return db.query.calendarFeedTokens.findFirst({
      where: eq(calendarFeedTokens.token, token),
    });
  }

  /** The user fields needed to resolve their calendar visibility for the feed. */
  static async findFeedUser(userId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, role: true, roles: true, major: true, studentId: true },
    });
  }

  /** Bumps the token's lastUsedAt. Callers treat this as best-effort. */
  static async touchFeedTokenLastUsed(token: string) {
    await db.update(calendarFeedTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(calendarFeedTokens.token, token));
  }
}
