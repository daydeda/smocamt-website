import { db } from "@/db";
import { attendance, events, formReminders, formSubmissions, forms } from "@/db/schema";
import { and, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { isFormOpenForSubmission } from "@/lib/access/form-access";
import { formReminderPayload, isReminderFormType, reminderStage } from "@/lib/push/reminders";
import { PushService } from "./push.service";

const DAY_MS = 24 * 60 * 60 * 1000;

export class ReminderService {
  /**
   * Pushes "form closes soon" reminders (24h and 1h before closes_at) to students who
   * still owe the form. The audience mirrors GET /api/forms/pending: K_pre needs any
   * registration, K_post / A / F need a check-in, and a student who already submitted
   * is skipped. Each (form, stage) is claimed in form_reminders before sending, so
   * overlapping or restarted ticks never notify twice.
   */
  static async runFormReminders(now: Date = new Date()): Promise<{ forms: number; notified: number }> {
    const candidates = await db
      .select()
      .from(forms)
      .where(and(isNotNull(forms.closesAt), gt(forms.closesAt, now), lte(forms.closesAt, new Date(now.getTime() + DAY_MS))));

    let notified = 0;
    let handled = 0;
    for (const form of candidates) {
      if (!isReminderFormType(form.formType) || !isFormOpenForSubmission(form, now)) continue;
      const stage = reminderStage(form.closesAt, now);
      if (!stage) continue;

      // A form first seen inside its last hour skips the 24h reminder.
      if (stage === "1h") {
        await db.insert(formReminders).values({ formId: form.id, stage: "1d" }).onConflictDoNothing();
      }
      const claimed = await db.insert(formReminders).values({ formId: form.id, stage }).onConflictDoNothing().returning();
      if (claimed.length === 0) continue;
      handled++;

      const rows = await db
        .select({ studentId: attendance.studentId, status: attendance.status })
        .from(attendance)
        .where(eq(attendance.eventId, form.eventId));
      const eligible = new Set(
        rows.filter((r) => form.formType === "K_pre" || r.status === "attended").map((r) => r.studentId),
      );
      if (eligible.size === 0) continue;

      const done = await db
        .select({ studentId: formSubmissions.studentId })
        .from(formSubmissions)
        .where(and(eq(formSubmissions.formId, form.id), inArray(formSubmissions.studentId, [...eligible])));
      for (const d of done) eligible.delete(d.studentId);
      if (eligible.size === 0) continue;

      const [event] = await db.select({ title: events.title }).from(events).where(eq(events.id, form.eventId));
      await PushService.sendToUserIds(
        [...eligible],
        formReminderPayload({ stage, formId: form.id, formType: form.formType, eventId: form.eventId, eventTitle: event?.title ?? null }),
      );
      notified += eligible.size;
    }
    return { forms: handled, notified };
  }
}
