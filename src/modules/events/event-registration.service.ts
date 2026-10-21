import { db } from "@/db";
import { attendance, events, users, forms, formSubmissions, eventSessions } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

// Error-message prefix thrown inside the registration transaction when a quota is
// hit; the route maps "<prefix>:<message>" to a 422.
export const QUOTA_FULL = "QUOTA_FULL";

export class EventRegistrationService {
  /**
   * The registering student's profile row: gate fields plus the identity +
   * medical/emergency fields only needed for the Songsue sync payload.
   */
  static async getRegistrationProfile(userId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        profileCompleted: true, major: true, registrationBlocked: true, noShowCount: true,
        // Identity + medical/emergency fields only needed for the Songsue sync
        // payload below — fetched here regardless (cheap, same row) rather than
        // a second query. See songsue-sync.ts's PDPA doc comment for how
        // Songsue gates writing these onto a synced account.
        email: true, name: true, prefix: true, faculty: true, phone: true, studentId: true,
        nickname: true, image: true, religion: true, contactChannels: true,
        chronicDiseases: true, medicalHistory: true, drugAllergies: true, foodAllergies: true,
        dietaryRestrictions: true, faintingHistory: true, emergencyMedication: true,
        emergencyContacts: true,
      },
    });
  }

  /** The student's existing attendance row for this event, if any. */
  static async findExistingRegistration(eventId: string, userId: string) {
    return db.query.attendance.findFirst({
      where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, userId)),
    });
  }

  /**
   * Atomically registers a student, enforcing the overall and cohort quotas.
   * Throws Error(`${QUOTA_FULL}:<message>`) when a quota is full and
   * Error("ALREADY_REGISTERED") on a duplicate-click race.
   */
  static async registerWithQuota(params: {
    eventId: string;
    userId: string;
    event: typeof events.$inferSelect;
    isEventStaff: boolean;
    isThai: boolean;
    isIntl: boolean;
  }) {
    const { eventId, userId, event, isEventStaff, isThai, isIntl } = params;
    // Quota enforcement must be atomic: count-then-insert without a lock lets N
    // concurrent requests all read the same sub-quota count and oversell the last
    // seat. We serialize on the event row (FOR UPDATE), recount inside the lock,
    // then insert — the walk-in path in scanner.service.ts uses the same pattern.
    await db.transaction(async (tx) => {
      await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for("update");

      // Anchor the registration to the event's first session. Single-session
      // events have exactly one, so this is unchanged. For a multi-day 'once'
      // event this single registration lets the student attend any day — the
      // scanner creates the per-day attended rows on check-in.
      const [firstSession] = await tx
        .select({ id: eventSessions.id })
        .from(eventSessions)
        .where(eq(eventSessions.eventId, eventId))
        .orderBy(asc(eventSessions.sortOrder), asc(eventSessions.startTime))
        .limit(1);
      if (!firstSession) throw new Error(`${QUOTA_FULL}:This event has no sessions yet`);

      if (!isEventStaff) {
        // Overall quota. Count DISTINCT students, not attendance rows: a multi-day
        // 'once' event creates an extra attended row per day for the same person, so
        // count(*) would inflate the seat count. Quota = number of people holding a seat.
        // Staff rows (isStaff=true) never count toward anyone's quota either.
        if (event.quota !== null && event.quota > 0) {
          const [{ value: currentCount }] = await tx
            .select({ value: sql<number>`count(distinct ${attendance.studentId})` })
            .from(attendance)
            .where(and(eq(attendance.eventId, eventId), eq(attendance.isStaff, false)));
          if (Number(currentCount) >= event.quota) throw new Error(`${QUOTA_FULL}:Event is full`);
        }

        // Cohort quota: Thai students
        if (isThai && event.quotaThai !== null && event.quotaThai > 0) {
          const [{ value: currentThaiCount }] = await tx
            .select({ value: sql<number>`count(distinct ${attendance.studentId})` })
            .from(attendance)
            .innerJoin(users, eq(attendance.studentId, users.id))
            .where(
              and(
                eq(attendance.eventId, eventId),
                eq(attendance.isStaff, false),
                sql`substr(${users.studentId}, length(${users.studentId}) - 2, 1) IN ('0', '1', '2', '3', '4')`
              )
            );
          if (Number(currentThaiCount) >= event.quotaThai) throw new Error(`${QUOTA_FULL}:Thai student quota is full`);
        }

        // Cohort quota: International students
        if (isIntl && event.quotaInternational !== null && event.quotaInternational > 0) {
          const [{ value: currentIntlCount }] = await tx
            .select({ value: sql<number>`count(distinct ${attendance.studentId})` })
            .from(attendance)
            .innerJoin(users, eq(attendance.studentId, users.id))
            .where(
              and(
                eq(attendance.eventId, eventId),
                eq(attendance.isStaff, false),
                sql`substr(${users.studentId}, length(${users.studentId}) - 2, 1) = '5'`
              )
            );
          if (Number(currentIntlCount) >= event.quotaInternational) throw new Error(`${QUOTA_FULL}:International student quota is full`);
        }
      }

      // Register. ON CONFLICT DO NOTHING covers a duplicate-click race against the
      // (session_id, student_id) unique index (the old event-level unique was
      // swapped to a per-session one in migrate step 39); 0 rows back means the
      // student already holds this session's seat.
      const inserted = await tx
        .insert(attendance)
        .values({
          eventId,
          sessionId: firstSession.id,
          studentId: userId,
          method: "pre-registered",
          status: "registered",
          checkInTime: null,
          isStaff: isEventStaff,
        })
        .onConflictDoNothing()
        .returning({ id: attendance.id });

      if (inserted.length === 0) throw new Error("ALREADY_REGISTERED");
    });
  }

  /** The event's first K_pre form, if any. */
  static async findPreTestForm(eventId: string) {
    return db.query.forms.findFirst({
      where: and(eq(forms.eventId, eventId), eq(forms.formType, "K_pre")),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
  }

  /** The student's submission (id only) for a form, if any. */
  static async findSubmissionId(formId: string, studentId: string) {
    return db.query.formSubmissions.findFirst({
      where: and(eq(formSubmissions.formId, formId), eq(formSubmissions.studentId, studentId)),
      columns: { id: true },
    });
  }

  /**
   * ALL of the student's rows for this event (a multi-day 'once' event has one
   * row per session), each with the event.
   */
  static async listRegistrationRowsWithEvent(eventId: string, userId: string) {
    return db.query.attendance.findMany({
      where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, userId)),
      columns: { status: true },
      with: { event: true },
    });
  }

  /**
   * Cancels a registration: deletes only NON-attended rows, then clears the
   * student's not-yet-finalized, zero-individual-point K_pre submissions.
   */
  static async cancelRegistration(eventId: string, userId: string) {
    // Delete only NON-attended rows. The guard above already guarantees no row is
    // 'attended', but scope the DELETE defensively (IS DISTINCT FROM also covers a
    // NULL status) so a real check-in can never be removed by an un-register.
    await db
      .delete(attendance)
      .where(and(
        eq(attendance.eventId, eventId),
        eq(attendance.studentId, userId),
        sql`${attendance.status} IS DISTINCT FROM 'attended'`,
      ));

    // Wipe the student's pre-test (K_pre) submission(s) for this event so that
    // re-registering forces them to retake it. GET /api/events derives the
    // forced-pre-test "open" state purely from whether a submission exists, so
    // clearing the row here is all that's needed to re-trigger the gate.
    //
    // SECURITY: never clear a pre-test that AWARDED individual points. Individual
    // points are permanent (award-individual-points.ts never claws them back) and
    // the (form_id, student_id) unique row is the ONLY re-award guard — deleting it
    // would let a student farm unlimited points via register → submit K_pre (+N) →
    // unregister → re-register → re-submit. So a points-granting pre-test keeps its
    // submission (no forced retake on re-register); only not-yet-finalized
    // (isAwarded=false) AND zero-individual-point pre-tests are cleared. K_post/A/S
    // are never touched: they require attendance, which un-registering precludes.
    const preForms = await db.query.forms.findMany({
      where: and(eq(forms.eventId, eventId), eq(forms.formType, "K_pre")),
      columns: { id: true, isAwarded: true, individualPointsAwarded: true },
    });
    const clearableFormIds = preForms
      .filter((f) => !f.isAwarded && (f.individualPointsAwarded ?? 0) === 0)
      .map((f) => f.id);
    if (clearableFormIds.length > 0) {
      await db
        .delete(formSubmissions)
        .where(
          and(
            inArray(formSubmissions.formId, clearableFormIds),
            eq(formSubmissions.studentId, userId)
          )
        );
    }
  }

  /** Identity + medical/emergency fields for the Songsue "cancelled" sync payload. */
  static async getSongsueSyncProfile(userId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        email: true, studentId: true, name: true, prefix: true, faculty: true, major: true, phone: true,
        nickname: true, image: true, religion: true, contactChannels: true,
        chronicDiseases: true, medicalHistory: true, drugAllergies: true, foodAllergies: true,
        dietaryRestrictions: true, faintingHistory: true, emergencyMedication: true, emergencyContacts: true,
      },
    });
  }
}
