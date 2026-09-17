import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, noShowAppeals, users } from "@/db/schema";
import { effectiveRoles } from "@/lib/admin-access";
import { NO_SHOW_STRIKE_THRESHOLD, RESOLVE_APPEALS_ROLES } from "@/lib/strikes";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { PushService } from "@/modules/notifications/push.service";
import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

const resolveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

// Thrown inside the transaction when the appeal was resolved by a concurrent
// request between the pre-check and the update (double-click, two admins).
class AlreadyResolvedError extends Error {}

// PATCH /api/admin/appeals/[id] — approve or reject a student's no-show appeal
// for ONE event. Approving resolves the appeal, decrements the student's
// noShowCount by exactly 1 (unblocking if that drops it below the threshold),
// and flips that event's attendance row(s) from 'no_show' to 'excused' — all
// in one transaction. This deliberately does NOT touch any other strike the
// student has from a different event (US-STRI-15c: per-event appeals, not the
// blanket "reset to 0/3" the account-wide appeal used to do).
//
// Gated by RESOLVE_APPEALS_ROLES (src/lib/strikes.ts) — smo can view the queue
// (VIEW_APPEALS_ROLES, GET /api/admin/appeals) but not resolve. club_president/
// major_president are further scoped to appeals whose event they own, via the
// same EventScopeService used by apply-strikes.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const myRoles = effectiveRoles(session.user.role, session.user.roles);
    const smoPosition = session.user.smoPosition;
    const anusmoPosition = session.user.anusmoPosition;
    // Additively admit a registration-position holder (global via smo/anusmo, or
    // club/major-scoped) as an entry ticket — scoped down to their own club/major
    // by the EventScopeService check below, same as club_president/major_president.
    const regScope = await EventScopeService.getRegistrationPositionScope(session.user.id!, myRoles, smoPosition, anusmoPosition);
    const hasRegistrationAccess = regScope.global || regScope.clubIds.length > 0 || regScope.majors.length > 0;
    if (!(myRoles.some((r) => (RESOLVE_APPEALS_ROLES as readonly string[]).includes(r)) || hasRegistrationAccess)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = resolveSchema.parse(await req.json());

    const appeal = await db.query.noShowAppeals.findFirst({
      where: eq(noShowAppeals.id, id),
      columns: { id: true, userId: true, eventId: true, status: true, noShowCountAtAppeal: true },
      with: { event: { columns: { title: true, ownerClubIds: true, ownerMajors: true } } },
    });
    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 });
    }

    const isStaff = myRoles.some((r) => ["super_admin", "admin", "registration"].includes(r));
    const presidentTags = myRoles.filter((r) => ["club_president", "major_president"].includes(r));
    const hasPresidentTag = presidentTags.length > 0;
    if (!isStaff && (hasPresidentTag || hasRegistrationAccess)) {
      const access = await EventScopeService.resolveEventAccess({
        userId: session.user.id!, roles: myRoles, smoPosition, anusmoPosition, isUnscopedStaff: false, hasPresidentTag,
      });
      const managed = access.allowed && (access.unscoped || (appeal.event ? EventScopeService.isEventManagedByScope(appeal.event, access.scope) : false));
      if (!managed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (appeal.status !== "pending") {
      return NextResponse.json({ error: "This appeal has already been resolved" }, { status: 409 });
    }
    if (data.action === "approve" && !appeal.eventId) {
      return NextResponse.json({ error: "This appeal isn't linked to an event and can't be auto-resolved" }, { status: 400 });
    }

    const newStatus = data.action === "approve" ? "approved" : "rejected";

    await db.transaction(async (tx) => {
      // Re-assert 'pending' inside the transaction (not just the pre-check above) so
      // a concurrent PATCH on the same appeal — double-click, or two admins — can't
      // silently overwrite an already-resolved outcome (e.g. a reject clobbering an
      // approve that already decremented the student's strikes).
      const [updated] = await tx
        .update(noShowAppeals)
        .set({
          status: newStatus,
          reviewedBy: session!.user!.id!,
          reviewedAt: new Date(),
          reviewNote: data.note ?? null,
        })
        .where(and(eq(noShowAppeals.id, id), eq(noShowAppeals.status, "pending")))
        .returning({ id: noShowAppeals.id });

      if (!updated) {
        throw new AlreadyResolvedError();
      }

      let action = `${data.action === "approve" ? "Approved" : "Rejected"} no-show appeal ${id}`;

      if (data.action === "approve") {
        const [student] = await tx
          .select({ noShowCount: users.noShowCount })
          .from(users)
          .where(eq(users.id, appeal.userId));
        const newCount = Math.max(0, (student?.noShowCount ?? 0) - 1);
        const newBlocked = newCount >= NO_SHOW_STRIKE_THRESHOLD;

        await tx
          .update(users)
          .set({ noShowCount: newCount, registrationBlocked: newBlocked })
          .where(eq(users.id, appeal.userId));

        // Clears the event of its no-show mark so it stops counting toward
        // future strike displays; a multi-session event may have flipped more
        // than one attendance row when the strike was originally applied.
        await tx
          .update(attendance)
          .set({ status: "excused" })
          .where(and(
            eq(attendance.studentId, appeal.userId),
            eq(attendance.eventId, appeal.eventId!),
            eq(attendance.status, "no_show"),
          ));

        action += `, removed 1 strike for event ${appeal.eventId} (was ${student?.noShowCount ?? 0}/${NO_SHOW_STRIKE_THRESHOLD}, now ${newCount}/${NO_SHOW_STRIKE_THRESHOLD})`;
      }

      await AuditService.logActionInternal(tx, {
        actorId: session!.user!.id!,
        targetId: appeal.userId,
        action,
        ipAddress: getClientIp(req),
      });
    });

    after(async () => {
      await PushService.sendToUserIds([appeal.userId], {
        title: newStatus === "approved" ? "Your appeal was approved" : "Your appeal was rejected",
        body: appeal.event
          ? `Your no-show appeal for "${appeal.event.title}" was ${newStatus}.`
          : `Your no-show appeal was ${newStatus}.`,
        url: "/dashboard",
        tag: `appeal-decision:${id}`,
      });
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    if (error instanceof AlreadyResolvedError) {
      return NextResponse.json({ error: "This appeal has already been resolved" }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
