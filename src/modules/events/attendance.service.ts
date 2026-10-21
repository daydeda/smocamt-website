import { db } from "@/db";
import { attendance } from "@/db/schema";
import { and, eq, count } from "drizzle-orm";

export class AttendanceService {
  /**
   * Number of students who actually CHECKED IN (status 'attended') for an event,
   * optionally narrowed to one session.
   */
  static async countCheckedIn(eventId: string, sessionId?: string | null) {
    // Count only students who actually CHECKED IN (status 'attended'), not those
    // who merely pre-registered. Pre-registration writes an attendance row with
    // status 'registered' (method 'pre-registered'); scanning flips it to
    // 'attended'. Without this filter the live "Checked In" card would include
    // no-shows and would not climb as students scan in.
    const [row] = await db
      .select({ value: count() })
      .from(attendance)
      .where(
        sessionId
          ? and(
              eq(attendance.eventId, eventId),
              eq(attendance.sessionId, sessionId),
              eq(attendance.status, "attended"),
            )
          : and(
              eq(attendance.eventId, eventId),
              eq(attendance.status, "attended"),
            ),
      );
    return row?.value ?? 0;
  }
}
