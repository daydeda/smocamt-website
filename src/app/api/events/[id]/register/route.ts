import { auth } from "@/auth";
import { NextResponse, after } from "next/server";
import { getFormAvailability } from "@/lib/access/form-access";
import { isEligibleForEventYear, yearOfStudy } from "@/lib/access/event-access";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { EventsService } from "@/modules/events/events.service";
import { EventRegistrationService, NO_SESSIONS_MESSAGE, QUOTA_FULL } from "@/modules/events/event-registration.service";
import { PushService } from "@/modules/notifications/push.service";
import { captureException } from "@/lib/util/logger";
import { syncRegistrationToSongsue, type SongsueEmergencyContact } from "@/lib/integrations/songsue-sync";

type RegistrationProfile = NonNullable<Awaited<ReturnType<typeof EventRegistrationService.getRegistrationProfile>>>;

// Songsue "registered" payload user from a registration profile row.
function songsueUser(profile: RegistrationProfile) {
  return {
    email: profile.email,
    studentId: profile.studentId,
    name: profile.name,
    prefix: profile.prefix,
    faculty: profile.faculty,
    major: profile.major,
    phone: profile.phone,
    nickname: profile.nickname,
    image: profile.image,
    religion: profile.religion,
    contactChannels: profile.contactChannels,
    chronicDiseases: profile.chronicDiseases,
    medicalHistory: profile.medicalHistory,
    drugAllergies: profile.drugAllergies,
    foodAllergies: profile.foodAllergies,
    dietaryRestrictions: profile.dietaryRestrictions,
    faintingHistory: profile.faintingHistory,
    emergencyMedication: profile.emergencyMedication,
    emergencyContacts: profile.emergencyContacts as SongsueEmergencyContact[] | null,
  };
}

/**
 * After the response: push "you got a seat" to students promoted off the waitlist
 * and mirror their registrations into Songsue, same as a normal sign-up.
 */
function notifyPromoted(event: { id: string; title: string; songsueLinked: boolean | null }, userIds: string[]) {
  if (userIds.length === 0) return;
  after(async () => {
    await PushService.sendToUserIds(userIds, {
      title: "ได้ที่นั่งแล้ว! / You got a seat!",
      body: `คุณได้รับการลงทะเบียนกิจกรรม "${event.title}" แล้ว / You're now registered for "${event.title}".`,
      url: `/dashboard?event=${encodeURIComponent(event.id)}`,
      tag: `waitlist:${event.id}`,
    });
    if (event.songsueLinked) {
      for (const promotedId of userIds) {
        const p = await EventRegistrationService.getRegistrationProfile(promotedId);
        if (p) {
          await syncRegistrationToSongsue({ externalEventId: event.id, user: songsueUser(p), status: "registered" });
        }
      }
    }
  });
}

/** Fills freed seats from the waitlist; best-effort, never fails the request. */
async function promoteSafely(eventId: string, step: string): Promise<string[]> {
  try {
    return await EventRegistrationService.promoteFromWaitlist(eventId);
  } catch (err) {
    captureException(err, { route: "/api/events/[id]/register", step });
    return [];
  }
}

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
    const profile = await EventRegistrationService.getRegistrationProfile(userId);
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
    const event = await EventsService.getEventById(eventId);

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
    const adminRoles = ["super_admin", "admin"];
    // A GLOBAL registration position (smo/anusmo) bypasses audience limits like an
    // admin role (same rule as buildViewer in event-access.ts).
    const isAdminRole = adminRoles.includes(userRole)
      || isGlobalRegistrationPosition(effectiveRoles(session.user.role, session.user.roles), session.user.smoPosition, session.user.anusmoPosition);
    const allowedRoles = event.allowedRoles;
    if (
      Array.isArray(allowedRoles) &&
      allowedRoles.length > 0 &&
      !isAdminRole &&
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
      !isAdminRole &&
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
      !isAdminRole
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
    if (event.walkInsOnly && !isEventStaff && !isAdminRole) {
      return NextResponse.json(
        { error: "This event only accepts walk-in check-ins — there is no pre-registration. Just show up and get scanned in." },
        { status: 403 }
      );
    }

    // An ended event takes no sign-ups or waitlist joins, whatever the window says.
    if (new Date() > new Date(event.endTime) && !isEventStaff && !isAdminRole) {
      return NextResponse.json({ error: "This event has already ended" }, { status: 403 });
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

    // Match the year restriction used by event and calendar visibility.
    if (!isAdminRole && !isEligibleForEventYear(event, yearOfStudy(studentId))) {
      return NextResponse.json({ error: "This event is restricted to selected student years" }, { status: 403 });
    }

    // (Removed strict end time check to allow late registration if event is still visible)

    // Check if already registered
    const existing = await EventRegistrationService.findExistingRegistration(eventId, userId);

    if (existing) {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 409 });
    }

    try {
      await EventRegistrationService.registerWithQuota({ eventId, userId, event, isEventStaff, isThai, isIntl });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith(QUOTA_FULL)) {
        const reason = e.message.split(":")[1];
        if (reason === NO_SESSIONS_MESSAGE) {
          return NextResponse.json({ error: reason }, { status: 422 });
        }
        // Full (overall or this student's cohort): queue them instead. They get the
        // first seat that a cancellation frees and fits their cohort (see DELETE).
        await EventRegistrationService.joinWaitlist(eventId, userId);
        // A seat may have been freed between the quota check and the queue insert;
        // a promotion pass closes that gap (and may seat students ahead of them).
        const promotedNow = await promoteSafely(eventId, "promote-after-join");
        notifyPromoted(event, promotedNow.filter((id) => id !== userId));
        if (!promotedNow.includes(userId)) {
          const position = (await EventRegistrationService.listWaitlistPositions(userId, [eventId])).get(eventId) ?? 1;
          return NextResponse.json({ success: true, waitlisted: true, position, reason }, { status: 202 });
        }
        // Promoted straight away: carry on as a normal successful registration.
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
        user: songsueUser(profile),
        status: "registered",
      });
    }

    // Surface the event's pre-test (K_pre) state so the dashboard can force the
    // student into a required pre-test immediately after registering — using this
    // fresh value rather than the cached events list, which on a re-register still
    // shows the now-cleared "submitted" status until the next poll. Mirrors the
    // preTest shape returned by GET /api/events.
    const preForm = await EventRegistrationService.findPreTestForm(eventId);
    let preTest: { formId: string; title: string; status: string } | null = null;
    if (preForm) {
      const submitted = await EventRegistrationService.findSubmissionId(preForm.id, userId);
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
    const records = await EventRegistrationService.listRegistrationRowsWithEvent(eventId, userId);

    if (records.length === 0) {
      // Not registered, but maybe waiting in the queue: cancelling means leaving it.
      // Allowed at any time, since a queue place holds no seat.
      if (await EventRegistrationService.leaveWaitlist(eventId, userId)) {
        return NextResponse.json({ success: true, leftWaitlist: true });
      }
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

    await EventRegistrationService.cancelRegistration(eventId, userId);

    // The freed seat goes to the first student in the waitlist who fits the quotas.
    // Best-effort: the cancellation itself has already succeeded.
    if (event) {
      notifyPromoted(event, await promoteSafely(eventId, "promote-after-cancel"));
    }

    // Best-effort mirror into Songsue — never blocks unregistration (see songsue-sync.ts).
    if (event?.songsueLinked) {
      const profile = await EventRegistrationService.getSongsueSyncProfile(userId);
      if (profile) {
        await syncRegistrationToSongsue({
          externalEventId: event.id,
          user: { ...profile, emergencyContacts: profile.emergencyContacts as SongsueEmergencyContact[] | null },
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
