import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, events, users, forms, formSubmissions, eventSessions } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getFormAvailability } from "@/lib/form-access";
import { isFirstYearStudent } from "@/lib/event-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { syncRegistrationToSongsue } from "@/lib/songsue-sync";

// POST /api/events/[id]/register — One-click registration (FE-05)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const userId = session.user.id!;

    // Profile must be completed before registering. The proxy middleware keeps
    // incomplete profiles out of the dashboard, but the API is reachable directly,
    // so enforce it here too. Read from the DB rather than the session token, which
    // can be stale (auth.ts only eagerly refreshes while profileCompleted is false).
    const profile = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        profileCompleted: true, major: true, registrationBlocked: true, noShowCount: true,
        // Identity fields only needed for the Songsue sync payload below —
        // fetched here regardless (cheap, same row) rather than a second query.
        email: true, name: true, prefix: true, faculty: true, phone: true, studentId: true,
      },
    });
    if (!profile?.profileCompleted) {
      return NextResponse.json(
        { error: "Please complete your profile before registering for events" },
        { status: 403 }
      );
    }

    // No-show strike-out (US-STRI-15b): pre-registration is refused once a
    // student accumulates too many no-shows, until staff resets their strikes.
    if (profile.registrationBlocked) {
      return NextResponse.json(
        {
          error: "Your event pre-registration is temporarily blocked due to repeated no-shows. If you believe this is a mistake, contact staff to appeal.",
          registrationBlocked: true,
          noShowCount: profile.noShowCount,
        },
        { status: 403 }
      );
    }

    // Validate event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Explicitly assigned event staff (event.staffUserIds — set by an admin,
    // NOT derived from global role) are exempt from every quota below: they're
    // registering to work the event, not to take a participant's seat.
    const isEventStaff = Array.isArray(event.staffUserIds) && event.staffUserIds.includes(userId);

    // Role-based access control (mirrors the event-list filter so students can't
    // POST directly to a role-restricted event they can't see). null/[] = open to
    // all; admin-type roles always pass.
    const userRole = session.user.role || "student";
    const adminRoles = ["super_admin", "admin", "registration", "organizer"];
    const allowedRoles = event.allowedRoles;
    if (
      Array.isArray(allowedRoles) &&
      allowedRoles.length > 0 &&
      !adminRoles.includes(userRole) &&
      !allowedRoles.includes(userRole)
    ) {
      return NextResponse.json({ error: "You are not eligible to register for this event" }, { status: 403 });
    }

    // Major-based access control (mirrors the event-list filter). null/[] = open
    // to all majors; admin-type roles always pass. A user with no major set can't
    // satisfy a major restriction, so they're rejected like a non-matching major.
    const allowedMajors = event.allowedMajors;
    if (
      Array.isArray(allowedMajors) &&
      allowedMajors.length > 0 &&
      !adminRoles.includes(userRole) &&
      !(profile.major && allowedMajors.includes(profile.major))
    ) {
      return NextResponse.json({ error: "You are not eligible to register for this event" }, { status: 403 });
    }

    // Club-based access control (mirrors the event-list filter). null/[] = open
    // to all clubs; admin-type roles always pass. Membership is ANY club_members
    // role (member or president) — see ClubsService.getMemberClubIds.
    const allowedClubs = event.allowedClubs;
    if (
      Array.isArray(allowedClubs) &&
      allowedClubs.length > 0 &&
      !adminRoles.includes(userRole)
    ) {
      const myClubIds = await ClubsService.getMemberClubIds(userId);
      const inAllowedClub = myClubIds.some((id) => allowedClubs.includes(id));
      if (!inAllowedClub) {
        return NextResponse.json({ error: "You are not eligible to register for this event" }, { status: 403 });
      }
    }

    // Walk-ins-only events accept no pre-registration at all — staff (and
    // event staff themselves, who register to WORK the event) still register
    // normally, everyone else must be scanned in as a walk-in on the day.
    if (event.walkInsOnly && !isEventStaff && !adminRoles.includes(userRole)) {
      return NextResponse.json(
        { error: "This event only accepts walk-in check-ins — there is no pre-registration. Just show up and get scanned in." },
        { status: 403 }
      );
    }

    // Validate registration window if set
    if (event.registrationOpenTime && new Date() < new Date(event.registrationOpenTime)) {
      return NextResponse.json({ error: "Registration for this event has not opened yet" }, { status: 403 });
    }
    if (event.registrationCloseTime && new Date() > new Date(event.registrationCloseTime)) {
      return NextResponse.json({ error: "Registration for this event has closed" }, { status: 403 });
    }

    // Validate target audience eligibility
    const studentId = session.user.studentId || "";
    const cleanId = studentId.trim();
    let isThai = true;
    let isIntl = false;
    if (cleanId.length >= 3) {
      const lastThreeDigitFirst = cleanId.slice(-3)[0];
      if (lastThreeDigitFirst === "5") {
        isThai = false;
        isIntl = true;
      }
    }

    const targetThai = event.targetThai ?? true;
    const targetInternational = event.targetInternational ?? true;
    
    // Fallback: If both targets are false/unchecked, anyone can join!
    const effectiveThai = (!targetThai && !targetInternational) ? true : targetThai;
    const effectiveIntl = (!targetThai && !targetInternational) ? true : targetInternational;
    
    if (isThai && !effectiveThai) {
      return NextResponse.json({ error: "This event is for international students only" }, { status: 403 });
    }
    if (isIntl && !effectiveIntl) {
      return NextResponse.json({ error: "This event is for Thai students only" }, { status: 403 });
    }

    // First-year-only restriction (mirrors the event-list filter). Admin-type
    // roles bypass; everyone else must belong to the current first-year intake
    // (student-id prefix, derived from the date in event-access.ts).
    if (
      event.firstYearOnly &&
      !adminRoles.includes(userRole) &&
      !isFirstYearStudent(studentId)
    ) {
      return NextResponse.json({ error: "This event is for first-year students only" }, { status: 403 });
    }

    // (Removed strict end time check to allow late registration if event is still visible)

    // Check if already registered
    const existing = await db.query.attendance.findFirst({
      where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, userId)),
    });

    if (existing) {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 409 });
    }

    // Quota enforcement must be atomic: count-then-insert without a lock lets N
    // concurrent requests all read the same sub-quota count and oversell the last
    // seat. We serialize on the event row (FOR UPDATE), recount inside the lock,
    // then insert — the walk-in path in scanner.service.ts uses the same pattern.
    const QUOTA_FULL = "QUOTA_FULL";
    try {
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
    } catch (e) {
      if (e instanceof Error && e.message.startsWith(QUOTA_FULL)) {
        return NextResponse.json({ error: e.message.split(":")[1] }, { status: 422 });
      }
      if (e instanceof Error && e.message === "ALREADY_REGISTERED") {
        return NextResponse.json({ error: "Already registered for this event" }, { status: 409 });
      }
      throw e;
    }

    // Best-effort mirror into Songsue — never blocks registration (see songsue-sync.ts).
    if (event.songsueLinked) {
      await syncRegistrationToSongsue({
        externalEventId: event.id,
        user: {
          email: profile.email,
          studentId: profile.studentId,
          name: profile.name,
          prefix: profile.prefix,
          faculty: profile.faculty,
          major: profile.major,
          phone: profile.phone,
        },
        status: "registered",
      });
    }

    // Surface the event's pre-test (K_pre) state so the dashboard can force the
    // student into a required pre-test immediately after registering — using this
    // fresh value rather than the cached events list, which on a re-register still
    // shows the now-cleared "submitted" status until the next poll. Mirrors the
    // preTest shape returned by GET /api/events.
    const preForm = await db.query.forms.findFirst({
      where: and(eq(forms.eventId, eventId), eq(forms.formType, "K_pre")),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });
    let preTest: { formId: string; title: string; status: string } | null = null;
    if (preForm) {
      const submitted = await db.query.formSubmissions.findFirst({
        where: and(eq(formSubmissions.formId, preForm.id), eq(formSubmissions.studentId, userId)),
        columns: { id: true },
      });
      preTest = {
        formId: preForm.id,
        title: preForm.title,
        status: submitted ? "submitted" : getFormAvailability(preForm),
      };
    }

    return NextResponse.json({ success: true, preTest }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/events/[id]/register — Cancel registration
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const userId = session.user.id!;

    // Validate registration and check status/time. Read ALL of the student's rows
    // for this event (a multi-day 'once' event has one row per session): a single
    // arbitrary findFirst here could return a still-'registered' day while another
    // day is already 'attended', pass the guard below, and then the broad DELETE
    // would wipe that real check-in. So detect attendance across ANY row.
    const records = await db.query.attendance.findMany({
      where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, userId)),
      columns: { status: true },
      with: { event: true },
    });

    if (records.length === 0) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }

    const event = records[0].event;

    // Rule 1: Cannot un-register if already checked in on ANY session.
    if (records.some((r) => r.status === 'attended')) {
      return NextResponse.json({ error: "Cannot cancel registration after check-in" }, { status: 403 });
    }

    // Rule 2: Cannot un-register if event is past
    if (event && new Date() > new Date(event.endTime)) {
      return NextResponse.json({ error: "Cannot cancel registration for past events" }, { status: 403 });
    }

    // Rule 3: Cannot un-register once the registration window has closed. The
    // close time locks the headcount in both directions — no new sign-ups (POST)
    // and no cancellations — so organizers can rely on a stable list once it passes.
    if (event?.registrationCloseTime && new Date() > new Date(event.registrationCloseTime)) {
      return NextResponse.json({ error: "Cannot cancel registration after the registration window has closed" }, { status: 403 });
    }

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

    // Best-effort mirror into Songsue — never blocks unregistration (see songsue-sync.ts).
    if (event?.songsueLinked) {
      const profile = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, studentId: true, name: true, prefix: true, faculty: true, major: true, phone: true },
      });
      if (profile) {
        await syncRegistrationToSongsue({
          externalEventId: event.id,
          user: profile,
          status: "cancelled",
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
