import { db } from "@/db";
import { attendance } from "@/db/schema";
import { and, eq, count, inArray, isNotNull, sql } from "drizzle-orm";

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

  /** All of a student's attendance rows with event + session, newest check-in first (history page). */
  static async listHistoryForStudent(studentId: string) {
    return db.query.attendance.findMany({
      where: eq(attendance.studentId, studentId),
      with: { event: true, session: true },
      orderBy: (a, { desc }) => [desc(a.checkInTime)],
    });
  }

  /**
   * This student's arrival rank for each of the given sessions, in ONE windowed
   * query. rank() over each session's check-in order; only this student's rows
   * are kept.
   */
  static async getArrivalRanksForStudent(studentId: string, sessionIds: string[]) {
    const ranked = db
      .select({
        sessionId: attendance.sessionId,
        studentId: attendance.studentId,
        rnk: sql<number>`rank() over (partition by ${attendance.sessionId} order by ${attendance.checkInTime})`.as("rnk"),
      })
      .from(attendance)
      .where(and(inArray(attendance.sessionId, sessionIds), isNotNull(attendance.checkInTime)))
      .as("ranked");
    return db
      .select({ sessionId: ranked.sessionId, rnk: ranked.rnk })
      .from(ranked)
      .where(eq(ranked.studentId, studentId));
  }

  /** The student's attendance summary rows (dashboard eligibility + status map). */
  static async listSummaryForStudent(studentId: string) {
    return db.query.attendance.findMany({
      where: eq(attendance.studentId, studentId),
      columns: { eventId: true, checkInTime: true, checkOutTime: true, status: true },
    });
  }

  /** The student's attendance rows for one event (evidence check-in list). */
  static async listForStudentInEvent(eventId: string, studentId: string) {
    return db.query.attendance.findMany({
      where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, studentId)),
    });
  }

  /**
   * Any ATTENDED row for this student in the event, if one exists. Attendance is
   * one row PER SESSION, so existence of any attended session is what matters.
   */
  static async findAttendedRecord(eventId: string, studentId: string) {
    return db.query.attendance.findFirst({
      where: and(
        eq(attendance.eventId, eventId),
        eq(attendance.studentId, studentId),
        eq(attendance.status, "attended"),
      ),
    });
  }

  /**
   * Every attendance row of an event with roster fields only (no medical
   * detail), for the attendance report xlsx.
   */
  static async listReportRows(eventId: string) {
    // This report is reachable by scanner-only roles (smo) and registration/
    // organizer, so it deliberately pulls NO medical detail — only the roster
    // fields below.
    return db.query.attendance.findMany({
      where: eq(attendance.eventId, eventId),
      with: {
        user: { columns: { studentId: true, name: true, nickname: true } },
        session: { columns: { id: true, title: true, sortOrder: true } },
      },
    });
  }
}
