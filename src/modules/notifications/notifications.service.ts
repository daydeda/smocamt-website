import { db } from "@/db";
import { attendance, auditLogs, events, forms, formSubmissions } from "@/db/schema";
import { and, desc, eq, gt, inArray, like, or } from "drizzle-orm";

export class NotificationsService {
  /** The student's most recent attended check-ins after `since` (with event title). */
  static async listRecentCheckins(userId: string, since: Date) {
    return db
      .select({
        id: attendance.id,
        eventId: attendance.eventId,
        checkInTime: attendance.checkInTime,
        eventTitle: events.title,
        songsueLinked: events.songsueLinked,
      })
      .from(attendance)
      .innerJoin(events, eq(events.id, attendance.eventId))
      .where(
        and(
          eq(attendance.studentId, userId),
          eq(attendance.status, "attended"),
          gt(attendance.checkInTime, since),
        ),
      )
      .orderBy(desc(attendance.checkInTime))
      .limit(20);
  }

  /** Individual-score audit rows targeting this student after `since`. */
  static async listRecentScoreLogs(userId: string, since: Date) {
    return db
      .select({
        id: auditLogs.id,
        timestamp: auditLogs.timestamp,
        action: auditLogs.action,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetId, userId),
          gt(auditLogs.timestamp, since),
          or(
            like(auditLogs.action, "Awarded %individual points%"),
            like(auditLogs.action, "Deducted %individual points%"),
          ),
        ),
      )
      .orderBy(desc(auditLogs.timestamp))
      .limit(20);
  }

  /** K_pre forms attached to the given events. */
  static async listPreTestForms(eventIds: string[]) {
    return db
      .select({
        id: forms.id,
        eventId: forms.eventId,
        isActive: forms.isActive,
        closesAt: forms.closesAt,
      })
      .from(forms)
      .where(and(inArray(forms.eventId, eventIds), eq(forms.formType, "K_pre")));
  }

  /** Which of the given forms this student has already submitted. */
  static async listSubmittedFormIds(userId: string, formIds: string[]) {
    return db
      .select({ formId: formSubmissions.formId })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.studentId, userId),
          inArray(
            formSubmissions.formId,
            formIds,
          ),
        ),
      );
  }
}
