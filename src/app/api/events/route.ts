import { auth } from "@/auth";
import { EventRegistrationService } from "@/modules/events/event-registration.service";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getFormAvailability } from "@/lib/access/form-access";
import { buildViewer, isEligibleFor, isEligibleForGuest } from "@/lib/access/event-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { EventsService } from "@/modules/events/events.service";
import { AttendanceService } from "@/modules/events/attendance.service";
import { FormsService } from "@/modules/forms/forms.service";
import { UsersService } from "@/modules/users/users.service";

// Fail fast instead of hanging to the 300s platform default if the DB pooler stalls.
export const maxDuration = 20;

// Registered seat counts per event — DISTINCT students holding a seat, which is
// exactly the headcount the register route enforces quota against (a multi-day
// 'once' event creates extra attended rows per day for the same person, so
// count(*) would inflate it). This whole-table GROUP BY would otherwise re-run on
// every student dashboard poll, so cache it at the app layer for 15s (mirrors
// getAttendeeCounts in /api/admin/events). The per-user attendance/preForm reads
// below stay live — only this global aggregate is cached.
const getSeatCounts = unstable_cache(
  async () => EventsService.getSeatCounts(),
  ["events-seat-counts"],
  { revalidate: 15, tags: ["events-seat-counts"] },
);

const getWaitlistCounts = unstable_cache(
  async () => EventsService.getWaitlistCounts(),
  ["events-waitlist-counts"],
  { revalidate: 15, tags: ["events-waitlist-counts"] },
);

// GET /api/events — List all upcoming & past events (student-facing, FE-04)
export async function GET() {
  try {
    const session = await auth();


    const rawEvents = await EventsService.listAllByStartTime();
    // Strip internal president-ownership/review-state metadata before it
    // ever reaches a student/guest response — ownerClubIds/ownerMajors
    // identify which club_president/major_president manages an event (see
    // EventScopeService), and pendingDetailsChanges/pendingDetailsSubmittedBy/
    // pendingDetailsSubmittedAt hold an unapproved president edit awaiting
    // staff review (see PUT /api/admin/events/[id]) — none of this has any
    // bearing on student eligibility or what a student should see, so this
    // student-facing feed has no reason to expose it.
    const allEvents = rawEvents.map((event) => {
      const sanitized = { ...event };
      delete (sanitized as { ownerClubIds?: unknown }).ownerClubIds;
      delete (sanitized as { ownerMajors?: unknown }).ownerMajors;
      delete (sanitized as { pendingDetailsChanges?: unknown }).pendingDetailsChanges;
      delete (sanitized as { pendingDetailsSubmittedBy?: unknown }).pendingDetailsSubmittedBy;
      delete (sanitized as { pendingDetailsSubmittedAt?: unknown }).pendingDetailsSubmittedAt;
      return sanitized;
    });

    // Registered seat counts per event (see getSeatCounts) — one cached grouped
    // query, reused by both the guest and authenticated branches so the dashboard
    // can show "X / quota".
    const seatCounts = await getSeatCounts();
    const seatCountMap = new Map(seatCounts.map((c) => [c.eventId, Number(c.value)]));
    const waitlistCounts = await getWaitlistCounts();
    const waitlistCountMap = new Map(waitlistCounts.map((c) => [c.eventId, Number(c.value)]));

    if (!session?.user) {
      // For guest, filter events by allowedRoles: only show if no role limits, or if "student" is allowed
      const eligibleEvents = allEvents.filter((event) => isEligibleForGuest(event));

      const enrichedEvents = eligibleEvents.map((event) => ({
        ...event,
        isRegistered: false,
        attendanceStatus: null,
        registeredCount: seatCountMap.get(event.id) ?? 0,
        waitlistCount: waitlistCountMap.get(event.id) ?? 0,
        pointsCredited: false,
      }));
      return NextResponse.json(enrichedEvents);
    }

    const userRoles = session.user.roles || [session.user.role || "student"];

    // Major used for major-based access control (not on the session token).
    const me = await UsersService.getMajorById(session.user.id!);

    // Club memberships (any role) — powers the allowedClubs eligibility check below.
    const clubIds = await ClubsService.getMemberClubIds(session.user.id!);

    // Single shared visibility predicate (also used by the calendar + .ics feed).
    const viewer = buildViewer({
      roles: userRoles,
      studentId: session.user.studentId,
      major: me?.major,
      clubIds,
    });

    // Fetch the user's attendance up front: a student who has an attendance row
    // for an event must always see it on their dashboard, even if the event's
    // audience/role/major restrictions would otherwise exclude them. Admins can
    // manually check in (or walk in) a student to a restricted event via the
    // scanner — which bypasses every eligibility rule below — so the dashboard
    // has to honour that same bypass or the check-in silently vanishes here.
    const userId = session.user.id!;
    const userAttendances = await AttendanceService.listSummaryForStudent(userId);

    const attendanceMap = new Map(userAttendances.map((a) => [a.eventId, a]));

    // The student's place in line for any full event they are waiting on.
    const waitlistMap = await EventRegistrationService.listWaitlistPositions(userId);

    const eligibleEvents = allEvents.filter((event) => {
      // Always surface an event the student is registered for / checked into,
      // regardless of the eligibility rules below.
      if (attendanceMap.has(event.id)) return true;
      // SMO (and admin roles) see every event; canRegister below keeps the
      // ineligible ones view-only.
      return viewer.canViewAll || isEligibleFor(event, viewer);
    });

    // Pre-test (K_pre) status per event, so the dashboard can force a student to
    // complete a required pre-test right after registering. We surface the form id
    // plus a status: "open" (must complete), "submitted" (done), or
    // "upcoming"/"closed" (can't submit yet/anymore, so not forced).
    const eligibleIds = eligibleEvents.map((e) => e.id);
    const preForms = eligibleIds.length
      ? await FormsService.listPreTestFormsForEvents(eligibleIds)
      : [];

    // First K_pre form per event (an event normally has at most one).
    const preByEvent = new Map<string, (typeof preForms)[number]>();
    for (const f of preForms) {
      if (!preByEvent.has(f.eventId)) preByEvent.set(f.eventId, f);
    }

    const preFormIds = preForms.map((f) => f.id);
    const preSubs = preFormIds.length
      ? await FormsService.listSubmissionsForStudent(userId, preFormIds)
      : [];
    const submittedFormIds = new Set(preSubs.map((s) => s.formId));

    const enrichedEvents = eligibleEvents.map((event) => {
      const pf = preByEvent.get(event.id);
      const preTest = pf
        ? {
            formId: pf.id,
            title: pf.title,
            status: submittedFormIds.has(pf.id) ? "submitted" : getFormAvailability(pf),
          }
        : null;
      const att = attendanceMap.get(event.id);
      return {
        ...event,
        isRegistered: attendanceMap.has(event.id),
        // false = visible but not open to this viewer (view-only; the register route enforces it too).
        canRegister: isEligibleFor(event, viewer),
        attendanceStatus: att?.status || null,
        registeredCount: seatCountMap.get(event.id) ?? 0,
        waitlistCount: waitlistCountMap.get(event.id) ?? 0,
        waitlistPosition: waitlistMap.get(event.id) ?? null,
        preTest,
        // requireCheckOut events defer the individual-points award to the check-out
        // step (ScannerService.confirmCheckout) — an 'attended' row with no
        // checkOutTime yet hasn't actually had individualPointsAwarded credited, so
        // the dashboard's "Points" stat must not count it as earned until then.
        pointsCredited: att?.status === "attended" && (!event.requireCheckOut || !!att.checkOutTime),
      };
    });

    return NextResponse.json(enrichedEvents);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
