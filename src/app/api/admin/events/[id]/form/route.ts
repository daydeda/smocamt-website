import type { Session } from "next-auth";
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { normalizeForm, computeScore, type AnswerMap } from "@/lib/forms/form-schema";
import { ASSIGNABLE_ROLES, canSeeRespondentIdentity } from "@/lib/access/form-access";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { revalidateLeaderboards } from "@/lib/points/leaderboard-cache";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { EventsService } from "@/modules/events/events.service";
import { FormsService } from "@/modules/forms/forms.service";

// Staff (admin, or a global registration position) manage every event's forms, unscoped. club_president/major_president may
// also fully manage forms (create/edit/delete/schedule/identity toggle), but only
// for events they own — mirrors the scoping already used for attendance/strikes/
// appeals (see EventScopeService). smo gets read-only access to every event's
// forms, unscoped — it may GET but never create/edit/delete.
const STAFF_ROLES = ["super_admin", "admin"];
const PRESIDENT_ROLES = ["club_president", "major_president"];
const VIEW_ONLY_ROLES = ["smo"];

// Gate + (for presidents) scope-check a request against the event. `write`
// widens/narrows which roles qualify: writes exclude the view-only roles and
// always require presidents to own the event; reads admit view-only roles too,
// unscoped. Also returns `isStaff` so callers can decide the review-gate
// behavior (see forms.reviewStatus in schema.ts): staff writes are always
// auto-approved, a president's writes always land back in 'pending'.
async function gateEventForms(eventId: string, session: Session | null, write: boolean) {
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), isStaff: false };
  }
  const myRoles = effectiveRoles(session.user.role, session.user.roles);
  const smoPosition = session.user.smoPosition;
  const anusmoPosition = session.user.anusmoPosition;
  // A global registration position (smo/anusmo + position="registration") gets
  // full staff-tier breadth (auto-approved writes, unscoped) — fold into isStaff.
  const isStaff = myRoles.some((r) => STAFF_ROLES.includes(r)) || isGlobalRegistrationPosition(myRoles, smoPosition, anusmoPosition);
  const presidentTags = myRoles.filter((r) => PRESIDENT_ROLES.includes(r));
  const isViewOnly = !write && myRoles.some((r) => VIEW_ONLY_ROLES.includes(r));
  // A club/major-scoped registration position (not global, not staff) is a new
  // entry path mirroring presidents: scoped, non-staff-tier (pending-review) writes.
  const isPositionScoped = !isStaff && (await EventScopeService.hasRegistrationScope(session.user.id!, myRoles, smoPosition, anusmoPosition));

  if (!isStaff && presidentTags.length === 0 && !isViewOnly && !isPositionScoped) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), isStaff };
  }

  if (isStaff || isViewOnly) {
    return { error: null as NextResponse | null, isStaff };
  }

  // Only presidents / a position-scoped registration holder left — must own the event.
  const event = await EventsService.getEventIdAndOwnership(eventId);
  if (!event) {
    return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }), isStaff };
  }
  const access = await EventScopeService.resolveEventAccess({
    userId: session.user.id!, roles: myRoles, smoPosition, anusmoPosition, isUnscopedStaff: false, hasPresidentTag: presidentTags.length > 0,
  });
  const managed = access.allowed && (access.unscoped || EventScopeService.isEventManagedByScope(event, access.scope));
  if (!managed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), isStaff };
  }
  return { error: null as NextResponse | null, isStaff };
}

// Parse an incoming datetime (ISO string) into a Date, or null. Invalid/empty
// values become null (unbounded on that side of the window).
function parseDateOrNull(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Keep only valid, de-duplicated role strings from the assignable set.
function sanitizeRoles(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const allowed = ASSIGNABLE_ROLES as readonly string[];
  return [...new Set(v.filter((r): r is string => typeof r === "string" && allowed.includes(r)))];
}

// Keep only non-empty string ids, de-duplicated.
function sanitizeUserIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
}

// Resolve a new form's identity-visibility flag: an explicit boolean wins;
// otherwise every form type defaults to hidden identity — so opening
// submissions access to more roles (registration/organizer today, more roles
// later) doesn't silently expose who said what. The creator opts in per form
// when identity is genuinely needed (e.g. registration-style collection).
function resolveShowRespondentIdentity(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

// Bound a form's point award the same way manual house adjustments are capped
// (±10000, see /api/admin/houses/points) so a typo like 1000000 can't swing the
// leaderboard. Non-numeric input falls back to 0 (matches the old `|| 0`).
const MAX_FORM_POINTS = 10000;
function clampPoints(v: unknown): number {
  const n = parseInt(v as string);
  if (Number.isNaN(n)) return 0;
  return Math.max(-MAX_FORM_POINTS, Math.min(MAX_FORM_POINTS, n));
}

// Tolerantly read a JSON request body: a malformed/empty payload yields null so the
// handler can answer 400 instead of letting the bare await throw a 500.
async function readJsonBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// GET /api/admin/events/[id]/form — fetch all forms for this event with stats & submissions
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: eventId } = await params;
    const gate = await gateEventForms(eventId, session, false);
    if (gate.error) return gate.error;

    const allForms = await FormsService.listFormsWithSubmissionsForEvent(eventId);

    let identityVisibleSubmissions = 0;
    const result = allForms.map((formObj) => {
      const houseStats: Record<string, number> = { red: 0, green: 0, yellow: 0, blue: 0 };
      for (const sub of formObj.submissions) {
        const hId = sub.user?.houseId;
        if (hId && houseStats[hId] !== undefined) houseStats[hId]++;
      }

      const normalized = normalizeForm(formObj.questions);
      // super_admin/admin always see who submitted; other viewers (registration,
      // organizer, and any role granted access later) only do when the form
      // creator opted in via showRespondentIdentity — see form-access.ts.
      const canSeeIdentity = canSeeRespondentIdentity(session!.user!.role, formObj.showRespondentIdentity, formObj.reviewStatus);

      return {
        id: formObj.id,
        eventId: formObj.eventId,
        formType: formObj.formType,
        sortOrder: formObj.sortOrder,
        title: formObj.title,
        description: formObj.description,
        questions: formObj.questions,
        pointsAwarded: formObj.pointsAwarded,
        individualPointsAwarded: formObj.individualPointsAwarded,
        isActive: formObj.isActive,
        isAwarded: formObj.isAwarded,
        opensAt: formObj.opensAt,
        closesAt: formObj.closesAt,
        assignedRoles: formObj.assignedRoles ?? [],
        assignedUserIds: formObj.assignedUserIds ?? [],
        showRespondentIdentity: formObj.showRespondentIdentity,
        reviewStatus: formObj.reviewStatus,
        reviewedBy: formObj.reviewedBy,
        reviewedAt: formObj.reviewedAt,
        reviewNote: formObj.reviewNote,
        stats: houseStats,
        submissions: formObj.submissions.map((sub) => {
          const { score, maxScore, hasGraded } = computeScore(normalized, (sub.answers as AnswerMap) || {});
          if (canSeeIdentity) identityVisibleSubmissions++;
          return {
            id: sub.id,
            studentName: canSeeIdentity ? (sub.user?.name || "Student") : "",
            studentId: canSeeIdentity ? (sub.user?.studentId || "") : "",
            houseId: sub.user?.houseId || "unassigned",
            nickname: canSeeIdentity ? (sub.user?.nickname || "") : "",
            major: canSeeIdentity ? (sub.user?.major || "") : "",
            phone: canSeeIdentity ? (sub.user?.phone || "") : "",
            contactChannels: canSeeIdentity ? (sub.user?.contactChannels || "") : "",
            identityHidden: !canSeeIdentity,
            answers: sub.answers,
            submittedAt: sub.submittedAt,
            score,
            maxScore,
            hasGraded,
          };
        }),
      };
    });

    // PDPA: the admin form view can return every submitter's phone + contact
    // channels (when their identity isn't anonymized — see canSeeRespondentIdentity
    // above). Log the read (who/when/how much was actually identified), mirroring
    // the attendance-list access log. Hard (not best-effort): if we can't record
    // the read, we don't serve it.
    const submissionCount = result.reduce((n, f) => n + f.submissions.length, 0);
    const event = await EventsService.getEventTitle(eventId);
    const eventLabel = event ? `"${event.title}" (${eventId})` : eventId;
    await AuditService.logAction({
      actorId: session!.user!.id!,
      action: `Viewed form submissions for event ${eventLabel} (${submissionCount} submissions; ${identityVisibleSubmissions} with submitter identity + phone/contact visible, ${submissionCount - identityVisibleSubmissions} anonymized)`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ forms: result });
  } catch (error) {
    console.error("Failed to fetch admin form data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/events/[id]/form — create a new form for the event
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: eventId } = await params;
    const gate = await gateEventForms(eventId, session, true);
    if (gate.error) return gate.error;

    const body = await readJsonBody(req);
    if (body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { title, description, questions, pointsAwarded, individualPointsAwarded, isActive, formType, sortOrder, opensAt, closesAt, assignedRoles, assignedUserIds, showRespondentIdentity } = body;

    const isValidQuestions =
      Array.isArray(questions) ||
      (questions && typeof questions === "object" && Array.isArray(questions.sections));

    if (!title || !isValidQuestions) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const validTypes = ["K_pre", "K_post", "A", "S", "F"];
    if (formType && !validTypes.includes(formType)) {
      return NextResponse.json({ error: "Invalid form_type" }, { status: 400 });
    }

    // "Closes at" is required — it's the trigger that closes the form and
    // auto-awards its points, so a form without it would never resolve.
    const opensAtDate = parseDateOrNull(opensAt);
    const closesAtDate = parseDateOrNull(closesAt);
    if (!closesAtDate) {
      return NextResponse.json({ error: "A valid \"Closes at\" time is required." }, { status: 400 });
    }
    if (opensAtDate && closesAtDate <= opensAtDate) {
      return NextResponse.json({ error: "\"Closes at\" must be after \"Opens at\"." }, { status: 400 });
    }

    // Review gate (see forms.reviewStatus in schema.ts): a staff create is
    // immediately self-approved; a president's create always starts 'pending'
    // until admin/registration reviews it — it's visible-but-closed to
    // participants until then (see getFormAvailability).
    const result = await FormsService.createEventForm({
        eventId,
        formType: formType || "K_post",
        sortOrder: sortOrder ?? 0,
        title,
        description: description || "",
        questions,
        pointsAwarded: clampPoints(pointsAwarded),
        individualPointsAwarded: clampPoints(individualPointsAwarded),
        isActive: isActive !== undefined ? !!isActive : true,
        opensAt: opensAtDate,
        closesAt: closesAtDate,
        assignedRoles: sanitizeRoles(assignedRoles),
        assignedUserIds: sanitizeUserIds(assignedUserIds),
        // A president may choose this too, same as staff — the review gate
        // right below (reviewStatus: 'pending' for a president's create) is
        // what actually protects this: a president's choice never goes live
        // for ANYONE (including themselves) until staff explicitly approves
        // it, so there's no self-enable bypass here despite honoring their
        // submitted value.
        showRespondentIdentity: resolveShowRespondentIdentity(showRespondentIdentity),
        reviewStatus: gate.isStaff ? "approved" : "pending",
        reviewedBy: gate.isStaff ? session!.user!.id! : null,
        reviewedAt: gate.isStaff ? new Date() : null,
    });

    await AuditService.logAction({
      actorId: session!.user!.id!,
      action: `Created form "${result.title}" (${result.id}) for event ${eventId} with award: ${result.pointsAwarded} house PTS, ${result.individualPointsAwarded} individual PTS, respondent identity ${result.showRespondentIdentity ? "visible" : "anonymized"} to non-admin viewers, review status: ${result.reviewStatus}`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, form: result });
  } catch (error) {
    console.error("Failed to create event form:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH /api/admin/events/[id]/form — update an existing form
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: eventId } = await params;
    const gate = await gateEventForms(eventId, session, true);
    if (gate.error) return gate.error;

    const body = await readJsonBody(req);
    if (body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { formId, action, reviewNote, title, description, questions, pointsAwarded, individualPointsAwarded, isActive, sortOrder, opensAt, closesAt, assignedRoles, assignedUserIds, showRespondentIdentity } = body;

    if (!formId) {
      return NextResponse.json({ error: "formId is required" }, { status: 400 });
    }

    const existing = await FormsService.findFormInEvent(formId, eventId);

    if (!existing) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    // Review-only action — staff approves a pending form, or leaves a note
    // asking the president for changes (stays pending; see forms.reviewStatus
    // in schema.ts). Doesn't touch any other field, mirrors the event-proposals
    // PATCH action pattern.
    if (action === "approve" || action === "requestChanges") {
      if (!gate.isStaff) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const note = typeof reviewNote === "string" ? reviewNote.trim().slice(0, 1000) || null : null;
      const reviewed = await FormsService.reviewEventForm(formId, eventId, {
        reviewStatus: action === "approve" ? "approved" : "pending",
        reviewedBy: session!.user!.id!,
        reviewNote: note,
      });

      await AuditService.logAction({
        actorId: session!.user!.id!,
        action: `${action === "approve" ? "Approved" : "Requested changes on"} form "${reviewed.title}" (${formId}) for event ${eventId}${note ? `: ${note}` : ""}`,
        ipAddress: getClientIp(req),
      });

      return NextResponse.json({ success: true, form: reviewed });
    }

    const isValidQuestions =
      !questions ||
      Array.isArray(questions) ||
      (questions && typeof questions === "object" && Array.isArray(questions.sections));

    if (!isValidQuestions) {
      return NextResponse.json({ error: "Invalid questions format" }, { status: 400 });
    }

    // The effective schedule after this update must still have a valid "Closes at"
    // (it's the auto-close/auto-award trigger), and it must be after "Opens at".
    const effectiveOpensAt = "opensAt" in body ? parseDateOrNull(opensAt) : existing.opensAt;
    const effectiveClosesAt = "closesAt" in body ? parseDateOrNull(closesAt) : existing.closesAt;
    if (!effectiveClosesAt) {
      return NextResponse.json({ error: "A valid \"Closes at\" time is required." }, { status: 400 });
    }
    if (effectiveOpensAt && effectiveClosesAt <= effectiveOpensAt) {
      return NextResponse.json({ error: "\"Closes at\" must be after \"Opens at\"." }, { status: 400 });
    }

    // Re-open: an already-awarded form whose new close time is back in the future
    // will accept entries again, so the points it already handed out must be
    // clawed back (and the form re-armed) — otherwise the next close double-counts.
    const reopening =
      existing.isAwarded && effectiveClosesAt.getTime() > Date.now();

    // Reverting real house points is sensitive — confine it to full admins, even
    // though registration/organizer may otherwise edit a form.
    if (reopening && !["super_admin", "admin"].includes(session!.user!.role || "")) {
      return NextResponse.json(
        { error: "Only an admin can re-open a form that has already awarded points." },
        { status: 403 }
      );
    }

    const result = await FormsService.updateEventForm({
      formId,
      eventId,
      reopening,
      actorId: session!.user!.id!,
      ipAddress: getClientIp(req),
      buildValues: () => ({
          title: title ?? existing.title,
          description: description ?? existing.description,
          questions: questions ?? existing.questions,
          pointsAwarded: pointsAwarded !== undefined ? clampPoints(pointsAwarded) : existing.pointsAwarded,
          individualPointsAwarded: individualPointsAwarded !== undefined ? clampPoints(individualPointsAwarded) : existing.individualPointsAwarded,
          // A re-open re-arms the form; otherwise honour an explicit isActive.
          isActive: reopening ? true : (isActive !== undefined ? !!isActive : existing.isActive),
          isAwarded: reopening ? false : existing.isAwarded,
          sortOrder: sortOrder !== undefined ? sortOrder : existing.sortOrder,
          opensAt: effectiveOpensAt,
          closesAt: effectiveClosesAt,
          assignedRoles: "assignedRoles" in body ? sanitizeRoles(assignedRoles) : existing.assignedRoles,
          assignedUserIds: "assignedUserIds" in body ? sanitizeUserIds(assignedUserIds) : existing.assignedUserIds,
          // A president may change this too, same as staff — see the matching
          // comment on the POST handler above for why the review gate below
          // is what actually protects this, not withholding write access.
          showRespondentIdentity: typeof showRespondentIdentity === "boolean" ? showRespondentIdentity : existing.showRespondentIdentity,
          // Review gate (see forms.reviewStatus in schema.ts): a staff edit is
          // self-approved; a president's edit ALWAYS lands back in 'pending' —
          // even editing an already-approved form re-closes it to participants
          // until admin/registration reviews it again. Any stale review note
          // from a prior round is cleared; the approve/requestChanges action
          // above is the only path that sets one.
          reviewStatus: gate.isStaff ? "approved" : "pending",
          reviewedBy: gate.isStaff ? session!.user!.id! : null,
          reviewedAt: gate.isStaff ? new Date() : null,
          reviewNote: null,
          updatedAt: new Date(),
      }),
    });

    // A revert changed house totals — bust the cached leaderboard so it reflects
    // the clawback on the next poll instead of waiting out the 15s window.
    if (reopening) {
      revalidateLeaderboards();
    }

    return NextResponse.json({ success: true, form: result });
  } catch (error) {
    console.error("Failed to update event form:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/admin/events/[id]/form — delete a specific form
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: eventId } = await params;
    const gate = await gateEventForms(eventId, session, true);
    if (gate.error) return gate.error;

    const body = await readJsonBody(req);
    if (body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { formId } = body;

    if (!formId) {
      return NextResponse.json({ error: "formId is required" }, { status: 400 });
    }

    const existing = await FormsService.findFormInEvent(formId, eventId);

    if (!existing) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (existing.isAwarded) {
      return NextResponse.json({ error: "Cannot delete a form that has already awarded points." }, { status: 400 });
    }

    await FormsService.deleteEventForm(formId, eventId);

    await AuditService.logAction({
      actorId: session!.user!.id!,
      action: `Deleted form "${existing.title}" (${formId}) from event ${eventId}`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete event form:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
