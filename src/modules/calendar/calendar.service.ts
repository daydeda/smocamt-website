import { db } from "@/db";
import { attendance } from "@/db/schema";
import { eq } from "drizzle-orm";
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
