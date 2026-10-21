import { db } from "@/db";
import { attendance, users } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { and, eq, count, inArray, isNotNull, sql } from "drizzle-orm";

// Columns read for a normal/staff roster. Medical free-text + emergency contacts
// are fetched so super_admin/admin (and, per the sanitize step, a club/major
// president viewing their own event) get full detail and registration/organizer
// can have the medical-CATEGORY signal derived below; they are stripped per-role
// in the sanitize step.
const FULL_USER_COLUMNS = {
  id: true,
  name: true,
  nickname: true,
  studentId: true,
  major: true,
  phone: true,
  role: true,
  roles: true,
  chronicDiseases: true,
  medicalHistory: true,
  drugAllergies: true,
  foodAllergies: true,
  dietaryRestrictions: true,
  faintingHistory: true,
  emergencyMedication: true,
  emergencyContacts: true,
  noShowCount: true,
} as const;

// Thin-roster role (smo) only ever receives identity + check-in (see sanitize
// step), so don't even fetch phone, emergency contacts, or medical detail. A
// strict subset of FULL_USER_COLUMNS. noShowCount is the exception — it's a
// strike tally, not PDPA-sensitive, so every role that reaches this roster
// gets it (powers the no-show filter).
const THIN_USER_COLUMNS = {
  id: true,
  name: true,
  nickname: true,
  studentId: true,
  major: true,
  role: true,
  roles: true,
  noShowCount: true,
} as const;

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

  /**
   * The attendance roster of an event (optionally one session/day) with
   * session, user and house. Thin-roster callers get a reduced user SELECT.
   * Medical detail is read here for non-thin callers — the route sanitizes it
   * per role and writes the PDPA audit entry for every sensitive read.
   */
  static async listRosterForEvent(eventId: string, sessionIdFilter: string | null, isThinRoster: boolean) {
    return db.query.attendance.findMany({
      where: sessionIdFilter
        ? and(eq(attendance.eventId, eventId), eq(attendance.sessionId, sessionIdFilter))
        : eq(attendance.eventId, eventId),
      with: {
        // Which session (day) this check-in belongs to, for per-day reporting.
        session: {
          columns: { id: true, title: true, sortOrder: true, startTime: true, endTime: true },
        },
        user: {
          // Staff get the full SELECT (medical detail is read here so the
          // "has a condition" signal can be derived, then forwarded only to
          // super_admin/admin). Thin-roster roles get a reduced SELECT — phone /
          // emergency contacts / medical are stripped from their response anyway,
          // so they aren't fetched. The cast keeps the inferred row type stable;
          // the omitted columns are simply absent at runtime and never read on the
          // thin-roster path.
          columns: (isThinRoster
            ? THIN_USER_COLUMNS
            : FULL_USER_COLUMNS) as typeof FULL_USER_COLUMNS,
          with: {
            house: {
              columns: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
      },
      orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
    });
  }

  /**
   * Removes one student's registration/check-in rows for an event (all sessions)
   * and writes the audit entry in one transaction. Returns the deleted rows.
   */
  static async removeStudentRegistration(eventId: string, studentId: string, eventTitle: string, actorId: string, ipAddress: string) {
    return db.transaction(async (tx) => {
      const deleted = await tx
        .delete(attendance)
        .where(and(eq(attendance.eventId, eventId), eq(attendance.studentId, studentId)))
        .returning({ id: attendance.id });
      if (deleted.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId,
          targetId: studentId,
          action: `Removed registration for student ${studentId} from event "${eventTitle}" (${eventId}) — ${deleted.length} row(s)`,
          ipAddress,
        });
      }
      return deleted;
    });
  }



  /**
   * The `user` column selection for the attendee export — medical/contact
   * columns are only selected for callers entitled to them (the route decides
   * which flags apply and writes the PDPA audit entry for the export).
   */
  static buildAttendeeUserColumns(flags: {
    includeFullContactColumns: boolean;
    isThinRoster: boolean;
    fetchMedicalFields: boolean;
    includeMedicalColumns: boolean;
  }) {
    const { includeFullContactColumns, isThinRoster, fetchMedicalFields, includeMedicalColumns } = flags;
    // Shared column selection for an attendee's `user` relation — also reused
    // (with `id` added) to fetch users who are on events.staffUserIds but
    // have no attendance row of their own.
    return {
      name: true,
      nickname: true,
      studentId: true,
      email: includeFullContactColumns,
      phone: !isThinRoster,
      contactChannels: includeFullContactColumns,
      major: true,
      role: true,
      chronicDiseases: fetchMedicalFields,
      medicalHistory: fetchMedicalFields,
      drugAllergies: fetchMedicalFields,
      foodAllergies: fetchMedicalFields,
      dietaryRestrictions: fetchMedicalFields,
      faintingHistory: fetchMedicalFields,
      emergencyMedication: fetchMedicalFields,
      emergencyContacts: includeMedicalColumns,
    } as const;
  }

  /** Attendance rows (with session, user per `userColumns`, house) for the xlsx export, newest check-in first. */
  static async listExportRows(
    eventId: string,
    sessionIdFilter: string | null,
    userColumns: ReturnType<typeof AttendanceService.buildAttendeeUserColumns>,
  ) {
    return db.query.attendance.findMany({
      where: sessionIdFilter
        ? and(eq(attendance.eventId, eventId), eq(attendance.sessionId, sessionIdFilter))
        : eq(attendance.eventId, eventId),
      with: {
        session: { columns: { title: true, sortOrder: true } },
        user: {
          columns: userColumns,
          with: {
            house: { columns: { id: true, name: true } },
          },
        },
      },
      orderBy: (attendance, { desc }) => [desc(attendance.checkInTime)],
    });
  }

  /** Users (with house) who are on the staff list but have no attendance row, for the export. */
  static async listUsersForExport(
    userIds: string[],
    userColumns: ReturnType<typeof AttendanceService.buildAttendeeUserColumns>,
  ) {
    return db.query.users.findMany({
      where: inArray(users.id, userIds),
      columns: { id: true, ...userColumns },
      with: { house: { columns: { id: true, name: true } } },
    });
  }
}
