import { db } from "@/db";
import { attendance, events, forms, formSubmissions, users } from "@/db/schema";
import { awardIndividualPoints } from "@/lib/points/award-individual-points";
import { revertFormAward } from "@/lib/points/award-points";
import { AuditService } from "@/modules/audit/audit.service";
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

  /** The event's K_pre forms in display order (dashboard forced pre-test). */
  static async listPreTestFormsForEvents(eventIds: string[]) {
    return db.query.forms.findMany({
      where: and(eq(forms.formType, "K_pre"), inArray(forms.eventId, eventIds)),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
  }

  /** All forms of one event in display order. */
  static async listFormsForEvent(eventId: string) {
    return db.query.forms.findMany({
      where: eq(forms.eventId, eventId),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
  }

  /** The student's submission for one form, if any. */
  static async findSubmission(formId: string, studentId: string) {
    return db.query.formSubmissions.findFirst({
      where: and(
        eq(formSubmissions.formId, formId),
        eq(formSubmissions.studentId, studentId)
      ),
    });
  }

  /** A form by id, only if it belongs to the given event. */
  static async findFormInEvent(formId: string, eventId: string) {
    return db.query.forms.findFirst({
      where: and(eq(forms.id, formId), eq(forms.eventId, eventId)),
    });
  }

  /**
   * Records a submission and (if the form grants any) awards the submitter
   * their individual points — atomically in one transaction. The (form_id,
   * student_id) unique index is the authoritative guard against a double-submit
   * race: the second insert throws 23505, the whole transaction rolls back, and
   * no points are awarded, so a duplicate submit can never double-award.
   */
  static async recordSubmission(params: {
    formId: string;
    formTitle: string;
    eventId: string;
    studentId: string;
    answers: unknown;
    individualPoints: number;
  }) {
    const { formId, formTitle, eventId, studentId: userId, answers, individualPoints } = params;
    await db.transaction(async (tx) => {
      await tx.insert(formSubmissions).values({ formId, studentId: userId, answers });

      if (individualPoints > 0) {
        const submitter = await tx.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { name: true, houseId: true },
        });
        const submitterName = submitter?.name ?? "Student";
        await awardIndividualPoints(tx, {
          studentId: userId,
          studentName: submitterName,
          houseId: submitter?.houseId ?? null,
          // Tagged with eventId only (never formId) so a form re-open's award
          // clawback leaves these permanent individual points untouched.
          eventId,
          points: individualPoints,
          reason: `Awarded ${individualPoints} individual points to ${submitterName} for completing form "${formTitle}"`,
          activityLabel: formTitle,
        });
      }
    });
  }

  /** All forms of an event with their submissions + submitter profile (admin form view; contact fields included). */
  static async listFormsWithSubmissionsForEvent(eventId: string) {
    return db.query.forms.findMany({
      where: eq(forms.eventId, eventId),
      with: {
        submissions: {
          with: {
            user: {
              columns: {
                name: true,
                studentId: true,
                houseId: true,
                nickname: true,
                major: true,
                phone: true,
                contactChannels: true,
              },
            },
          },
          orderBy: (s, { desc }) => [desc(s.submittedAt)],
        },
      },
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
  }

  /** Staff review action on a form (approve, or request changes and keep pending). Returns the updated form. */
  static async reviewEventForm(formId: string, eventId: string, review: {
    reviewStatus: "approved" | "pending";
    reviewedBy: string;
    reviewNote: string | null;
  }) {
    const [reviewed] = await db
      .update(forms)
      .set({
        reviewStatus: review.reviewStatus,
        reviewedBy: review.reviewedBy,
        reviewedAt: new Date(),
        reviewNote: review.reviewNote,
        updatedAt: new Date(),
      })
      .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
      .returning();
    return reviewed;
  }

  /** Inserts a new event form (review gate already decided by the caller) and returns it. */
  static async createEventForm(values: typeof forms.$inferInsert) {
    const [result] = await db
      .insert(forms)
      .values(values)
      .returning();
    return result;
  }

  /**
   * Updates an event form in ONE transaction: when re-opening an awarded form,
   * first reverts the house points it handed out, then applies the new values and
   * writes the audit entry. `buildValues` is evaluated inside the transaction.
   */
  static async updateEventForm(params: {
    formId: string;
    eventId: string;
    reopening: boolean | null;
    actorId: string;
    ipAddress: string;
    buildValues: () => Partial<typeof forms.$inferInsert>;
  }) {
    const { formId, eventId, reopening, actorId, ipAddress, buildValues } = params;
    return db.transaction(async (tx) => {
      let revertNote = "";
      if (reopening) {
        const reverted = await revertFormAward(tx, formId);
        revertNote = reverted.length
          ? " Reverted award: " +
            reverted.map((r) => `${r.houseId} -${r.points} PTS`).join(", ") +
            "."
          : " No points needed reverting.";
      }

      const [updated] = await tx
        .update(forms)
        .set(buildValues())
        .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
        .returning();

      await AuditService.logActionInternal(tx, {
        actorId,
        action: reopening
          ? `Re-opened awarded form "${updated.title}" (${formId}) for event ${eventId}.${revertNote}`
          : `Updated form "${updated.title}" (${formId}) for event ${eventId}, review status: ${updated.reviewStatus}`,
        ipAddress,
      });

      return updated;
    });
  }

  /** Deletes one form of an event. */
  static async deleteEventForm(formId: string, eventId: string) {
    await db.delete(forms).where(and(eq(forms.id, formId), eq(forms.eventId, eventId)));
  }
}
