import { db } from "@/db";
import { attendance, events, forms, formSubmissions } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export type FormRow = typeof forms.$inferSelect;

export class FormsService {
  /** All forms (newest first) with their submission ids, for the admin forms list. */
  static async listFormsWithSubmissions() {
    return db.query.forms.findMany({
      orderBy: [desc(forms.createdAt)],
      with: {
        submissions: {
          columns: {
            id: true
          }
        }
      }
    });
  }

  /** Inserts a new custom form and returns the created row. */
  static async createForm(values: typeof forms.$inferInsert) {
    const [newForm] = await db.insert(forms).values(values).returning();
    return newForm;
  }

  /** A student's attendance event ids + statuses (which events they joined / attended). */
  static async listAttendanceStatusesForStudent(studentId: string) {
    return db
      .select({ eventId: attendance.eventId, status: attendance.status })
      .from(attendance)
      .where(eq(attendance.studentId, studentId));
  }

  /** All forms attached to the given events, in display order. */
  static async listFormsForEvents(eventIds: string[]) {
    return db.query.forms.findMany({
      where: inArray(forms.eventId, eventIds),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
  }

  /** The student's submissions (formId only) among the given forms. */
  static async listSubmissionsForStudent(studentId: string, formIds: string[]) {
    return db.query.formSubmissions.findMany({
      where: and(
        eq(formSubmissions.studentId, studentId),
        inArray(formSubmissions.formId, formIds),
      ),
      columns: { formId: true },
    });
  }

  /** id + title of the given events. */
  static async listEventTitles(eventIds: string[]) {
    return db.query.events.findMany({
      where: inArray(events.id, eventIds),
      columns: { id: true, title: true },
    });
  }

  /** One form submission by id (private file-answer view). */
  static async getSubmissionById(submissionId: string) {
    return db.query.formSubmissions.findFirst({
      where: eq(formSubmissions.id, submissionId),
    });
  }

  /** Every form id this student has submitted. */
  static async listSubmittedFormIds(studentId: string) {
    return db
      .select({ formId: formSubmissions.formId })
      .from(formSubmissions)
      .where(eq(formSubmissions.studentId, studentId));
  }

  /** All skill ("S") forms with their event, in display order. */
  static async listSkillFormsWithEvent() {
    return db.query.forms.findMany({
      where: eq(forms.formType, "S"),
      with: { event: true },
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
  }
}
