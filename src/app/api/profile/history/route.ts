import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, forms, formSubmissions } from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { canAccessSkillForm, getFormAvailability } from "@/lib/access/form-access";

// Shape of a form as it appears in a history entry's `forms` array.
type FormStatus = "available" | "submitted" | "closed" | "upcoming";

interface EventFormStatus {
  id: string;
  formType: string;
  title: string;
  sortOrder: number;
  formStatus: FormStatus;
  formPoints: number;
  formIndividualPoints: number;
  opensAt: Date | string | null;
  closesAt: Date | string | null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role || "";
    const me = { id: userId, role: userRole };

    // Whether the viewer is assigned (by role or by person) to a given S form —
    // managers are NOT counted here so an admin's history isn't flooded with every
    // event's skill form (admins fill those from the admin form builder instead).
    const isAssignedTo = (f: { assignedRoles?: string[] | null; assignedUserIds?: string[] | null }) => {
      const roles = f.assignedRoles ?? [];
      const ids = f.assignedUserIds ?? [];
      return (!!userRole && roles.includes(userRole)) || ids.includes(userId);
    };

    // Compute the per-viewer status of a form (submitted / available / scheduled).
    const buildFormStatus = (
      formObj: typeof forms.$inferSelect,
      hasSubmission: boolean
    ): EventFormStatus => {
      let formStatus: FormStatus;
      if (hasSubmission) {
        formStatus = "submitted";
      } else {
        const availability = getFormAvailability(formObj);
        formStatus = availability === "open" ? "available" : availability === "upcoming" ? "upcoming" : "closed";
      }
      return {
        id: formObj.id,
        formType: formObj.formType,
        title: formObj.title,
        sortOrder: formObj.sortOrder,
        formStatus,
        formPoints: formObj.pointsAwarded ?? 0,
        formIndividualPoints: formObj.individualPointsAwarded ?? 0,
        opensAt: formObj.opensAt,
        closesAt: formObj.closesAt,
      };
    };

    const userAttendances = await db.query.attendance.findMany({
      where: eq(attendance.studentId, userId),
      with: { event: true, session: true },
      orderBy: (a, { desc }) => [desc(a.checkInTime)],
    });

    const attendedEventIds = new Set(userAttendances.map((a) => a.eventId));

    // ── Batched lookups: these three replace what used to be on the order of
    // E·(1 + S + F) per-request round-trips (a forms.findMany per event, a count()
    // per session, and a findFirst per form) with three queries total. ────────────

    // 1. All of THIS student's form submissions, as a Set of formIds (was a findFirst
    //    per form). hasSubmission is now an in-memory lookup.
    const submittedRows = await db
      .select({ formId: formSubmissions.formId })
      .from(formSubmissions)
      .where(eq(formSubmissions.studentId, userId));
    const submittedFormIds = new Set(submittedRows.map((s) => s.formId));

    // 2. Every form for every attended event, grouped by eventId (was a forms.findMany
    //    per event inside the loop).
    const allEventForms = attendedEventIds.size
      ? await db.query.forms.findMany({
          where: inArray(forms.eventId, [...attendedEventIds]),
          orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
        })
      : [];
    const formsByEvent = new Map<string, typeof allEventForms>();
    for (const f of allEventForms) {
      const arr = formsByEvent.get(f.eventId) ?? [];
      arr.push(f);
      formsByEvent.set(f.eventId, arr);
    }

    // 3. Each checked-in session's arrival rank for THIS student, in ONE windowed
    //    query (was a count() per session). rank() over each session's check-in
    //    order; we then keep only this student's rows.
    const checkedInSessionIds = [
      ...new Set(userAttendances.filter((a) => a.checkInTime).map((a) => a.sessionId)),
    ];
    const rankBySession = new Map<string, number>();
    if (checkedInSessionIds.length > 0) {
      const ranked = db
        .select({
          sessionId: attendance.sessionId,
          studentId: attendance.studentId,
          rnk: sql<number>`rank() over (partition by ${attendance.sessionId} order by ${attendance.checkInTime})`.as("rnk"),
        })
        .from(attendance)
        .where(and(inArray(attendance.sessionId, checkedInSessionIds), isNotNull(attendance.checkInTime)))
        .as("ranked");
      const rankRows = await db
        .select({ sessionId: ranked.sessionId, rnk: ranked.rnk })
        .from(ranked)
        .where(eq(ranked.studentId, userId));
      for (const r of rankRows) rankBySession.set(r.sessionId, Number(r.rnk));
    }

    // A multi-session event has ONE attendance row per session (uniqueness is
    // per-session, not per-event), but history shows one card per EVENT. Group
    // the rows by event so a multi-day event collapses into a single entry
    // (this also de-dups the event-level forms, which are otherwise repeated).
    const attByEvent = new Map<string, typeof userAttendances>();
    for (const a of userAttendances) {
      const list = attByEvent.get(a.eventId) ?? [];
      list.push(a);
      attByEvent.set(a.eventId, list);
    }

    // History entries for events the student registered for / attended. All the
    // per-entry data now comes from the in-memory maps above, so this is synchronous.
    const history = [...attByEvent.values()].map((group) => {
      const event = group[0].event;
      if (!event) return null;

      // The student's sessions for this event, in the session's own order
      // (sortOrder, then start time), each with its own check-in rank.
      const ordered = [...group].sort((a, b) => {
        const oa = a.session?.sortOrder ?? 0;
        const ob = b.session?.sortOrder ?? 0;
        if (oa !== ob) return oa - ob;
        const ta = a.session?.startTime ? new Date(a.session.startTime).getTime() : 0;
        const tb = b.session?.startTime ? new Date(b.session.startTime).getTime() : 0;
        return ta - tb;
      });
      const sessions = ordered.map((a) => ({
        sessionId: a.sessionId,
        title: a.session?.title ?? null,
        startTime: a.session?.startTime ?? null,
        checkInTime: a.checkInTime,
        method: a.method,
        rank: a.checkInTime ? rankBySession.get(a.sessionId) ?? null : null,
      }));

      // Representative row for the top-level/single-session display + sort:
      // the earliest session the student actually checked into, else the
      // first row if no session has a check-in yet.
      const checkedIn = group.filter((a) => a.checkInTime);
      const rep =
        checkedIn.length > 0
          ? checkedIn.reduce((a, b) => (a.checkInTime! <= b.checkInTime! ? a : b))
          : group[0];
      const repSession = sessions.find((s) => s.sessionId === rep.sessionId);

      const eventForms = formsByEvent.get(event.id) ?? [];

      // Non-S forms are shown to everyone; an S form only if the viewer may
      // access it (assigned by role/person, or a manager).
      const studentForms = eventForms
        .filter((f) => f.formType !== "S" || canAccessSkillForm(f, me))
        .map((formObj) => buildFormStatus(formObj, submittedFormIds.has(formObj.id)));

      return {
        id: rep.id,
        eventId: event.id,
        eventTitle: event.title,
        eventImageUrl: event.imageUrl,
        eventQuota: event.quota,
        eventStartTime: event.startTime,
        eventEndTime: event.endTime,
        checkInTime: rep.checkInTime,
        method: rep.method,
        rank: repSession?.rank ?? null,
        sessions,
        forms: studentForms,
      };
    });

    // S forms the viewer is assigned to on events they did NOT attend — surfaced
    // so assigned evaluators can fill them without being a participant.
    const assignedSForms = (
      await db.query.forms.findMany({
        where: eq(forms.formType, "S"),
        with: { event: true },
        orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
      })
    ).filter((f) => f.event && !attendedEventIds.has(f.eventId) && isAssignedTo(f));

    // Group assigned forms by event into synthetic (no check-in) history entries.
    const assignedByEvent = new Map<string, typeof assignedSForms>();
    for (const f of assignedSForms) {
      const list = assignedByEvent.get(f.eventId) ?? [];
      list.push(f);
      assignedByEvent.set(f.eventId, list);
    }

    const assignedEntries = [...assignedByEvent.values()].map((eventForms) => {
      const ev = eventForms[0].event!;
      const formsList = eventForms.map((formObj) =>
        buildFormStatus(formObj, submittedFormIds.has(formObj.id))
      );
      return {
        id: `assigned-${ev.id}`,
        eventId: ev.id,
        eventTitle: ev.title,
        eventImageUrl: ev.imageUrl,
        eventQuota: ev.quota,
        eventStartTime: ev.startTime,
        eventEndTime: ev.endTime,
        checkInTime: null,
        method: null,
        rank: null,
        sessions: [],
        assignedOnly: true, // attended=false; viewer is here only to evaluate
        forms: formsList,
      };
    });

    // no-store: a form just submitted must not be served as still "available"
    // from a stale cache (which would re-show the fillable button / deep-link).
    return NextResponse.json([...history.filter(Boolean), ...assignedEntries], {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to fetch student history:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
