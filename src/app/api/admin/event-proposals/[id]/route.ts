import { auth } from "@/auth";
import { db } from "@/db";
import { eventProposals } from "@/db/schema";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/events/event-proposals";
import { sessionsHaveInvalidSpan } from "@/lib/events/event-schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { EventProposalsService } from "@/modules/events/event-proposals.service";
import { MajorsService } from "@/modules/majors/majors.service";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const actionEnvelopeSchema = z.object({ action: z.enum(["reject", "withdraw", "resubmit"]) });

const reviewActionSchema = z.object({
  action: z.enum(["reject", "withdraw"]),
  reviewNote: z.string().trim().max(1000).optional(),
});

// Edited fields a proposer may resubmit with after a rejection — mirrors
// proposalCreateSchema in POST /api/admin/event-proposals exactly, minus
// clubId/majorCode (fixed at creation, never reassignable here).
const resubmitActionSchema = z
  .object({
    action: z.literal("resubmit"),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    registrationOpenTime: z.string().datetime().optional().nullable(),
    registrationCloseTime: z.string().datetime().optional().nullable(),
    location: z.string().trim().max(200).optional().nullable(),
    quota: z.number().int().min(0).optional().nullable(),
    imageUrl: z.string().optional().nullable(),
    imageUrls: z.array(z.string()).optional().nullable(),
    walkInsEnabled: z.boolean().optional(),
    walkInsOnly: z.boolean().optional(),
    quotaWalkIn: z.number().int().min(0).optional().nullable(),
    registrationMode: z.enum(["once", "per_session"]).optional(),
    sessions: z
      .array(
        z.object({
          title: z.string().trim().max(200).optional().nullable(),
          startTime: z.string().datetime(),
          endTime: z.string().datetime(),
        })
      )
      .optional()
      .nullable(),
    targetThai: z.boolean().optional(),
    targetInternational: z.boolean().optional(),
    quotaThai: z.number().int().min(0).optional().nullable(),
    quotaInternational: z.number().int().min(0).optional().nullable(),
    firstYearOnly: z.boolean().optional(),
    // Re-verified against the SAME club's roster server-side below, same as
    // POST — never trust the client-sent id list alone.
    staffUserIds: z.array(z.string()).optional().nullable(),
    allowedRoles: z.array(z.string()).optional().nullable(),
    allowedMajors: z.array(z.string()).optional().nullable(),
    allowedClubs: z.array(z.string().uuid()).optional().nullable(),
  })
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })
  .refine((d) => !d.sessions || !sessionsHaveInvalidSpan(d.sessions), {
    message: "Each day in a per-day schedule must start and end on the same calendar day — add each additional day as its own row instead of stretching one across several dates",
    path: ["endTime"],
  });

// Thrown inside the transaction when the proposal was already resolved by a
// concurrent request between the pre-check and the update (double-click, or
// staff creating the linked event at the same moment — see the proposalId
// linkage in POST /api/admin/events).
class AlreadyResolvedError extends Error {}

// GET /api/admin/event-proposals/[id] — staff-only single-record fetch, used
// by the admin/events "Create Event from Proposal" prefill flow.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    const isStaff = myRoles.some((r) => (REVIEW_PROPOSAL_ROLES as readonly string[]).includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isStaff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const proposal = await db.query.eventProposals.findFirst({
      where: eq(eventProposals.id, id),
      with: {
        club: { columns: { id: true, name: true, isArchived: true } },
        proposer: { columns: { id: true, name: true, studentId: true } },
        reviewer: { columns: { id: true, name: true } },
      },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    return NextResponse.json(proposal);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH /api/admin/event-proposals/[id] — reject (staff), withdraw (the
// proposer, own pending proposal only), or resubmit (the proposer, own
// REJECTED proposal only — edits the content and flips it back to pending so
// staff re-reviews it; see resubmitActionSchema above). Approval is NOT a
// mutation here — it's a side effect of staff creating the real event from
// the proposal (see POST /api/admin/events' proposalId linkage), so there is
// no "approve" action on this route. reject/withdraw re-assert
// status='pending' and resubmit re-asserts status='rejected' inside the same
// UPDATE...WHERE as the resolve step, mirroring
// /api/admin/appeals/[id]'s optimistic-guard pattern exactly.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { action } = actionEnvelopeSchema.parse(body);

    const proposal = await db.query.eventProposals.findFirst({
      where: eq(eventProposals.id, id),
      columns: { id: true, proposedBy: true, status: true, title: true, clubId: true, majorCode: true },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    const isStaff = myRoles.some((r) => (REVIEW_PROPOSAL_ROLES as readonly string[]).includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (action === "reject" && !isStaff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((action === "withdraw" || action === "resubmit") && proposal.proposedBy !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (action === "resubmit") {
      if (proposal.status !== "rejected") {
        return NextResponse.json({ error: "Only a rejected proposal can be resubmitted" }, { status: 409 });
      }

      const data = resubmitActionSchema.parse(body);

      // Re-verify the proposer still actually presides over this club/major —
      // mirrors POST's own scope check. A president role can be revoked
      // between the original submission and now; clubId/majorCode itself
      // can't be changed here so there's nothing else to re-check ownership of.
      const stillInScope = proposal.clubId
        ? await EventProposalsService.isClubInScope(session.user.id!, myRoles, proposal.clubId)
        : await EventProposalsService.isMajorInScope(session.user.id!, myRoles, proposal.majorCode!);
      if (!stillInScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Mirrors POST's own archived-club check — a club can be archived after
      // the original (rejected) submission, and re-opening it via resubmit
      // shouldn't bypass that (isClubInScope doesn't exclude archived clubs).
      if (proposal.clubId) {
        const club = await EventProposalsService.getClub(proposal.clubId);
        if (!club) {
          return NextResponse.json({ error: "Club not found" }, { status: 404 });
        }
        if (club.isArchived) {
          return NextResponse.json({ error: "This club has been archived" }, { status: 400 });
        }
      }

      // Never trust the client-sent staffUserIds — strip anyone who isn't
      // actually a member of THIS club/major (same rule as POST).
      let staffUserIds: string[] | null = null;
      if (data.staffUserIds && data.staffUserIds.length > 0) {
        if (proposal.clubId) {
          const members = await ClubsService.getClubMembers(proposal.clubId);
          const memberIds = new Set(members.map((m) => m.userId));
          const filtered = data.staffUserIds.filter((uid) => memberIds.has(uid));
          staffUserIds = filtered.length > 0 ? filtered : null;
        } else if (proposal.majorCode) {
          const members = await MajorsService.getMajorMembers(proposal.majorCode);
          const memberIds = new Set(members.map((m) => m.id));
          const filtered = data.staffUserIds.filter((uid) => memberIds.has(uid));
          staffUserIds = filtered.length > 0 ? filtered : null;
        }
      }

      const ip = getClientIp(req);
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(eventProposals)
          .set({
            title: data.title,
            description: data.description ?? null,
            startTime: new Date(data.startTime),
            endTime: new Date(data.endTime),
            registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null,
            registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null,
            location: data.location ?? null,
            quota: data.quota ?? null,
            imageUrl: data.imageUrls?.[0] ?? data.imageUrl ?? null,
            imageUrls: data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : null),
            walkInsEnabled: data.walkInsOnly ? true : (data.walkInsEnabled ?? false),
            walkInsOnly: data.walkInsOnly ?? false,
            quotaWalkIn: data.quotaWalkIn ?? null,
            registrationMode: data.registrationMode ?? "once",
            sessions: data.sessions && data.sessions.length > 0
              ? data.sessions.map((s) => ({ title: s.title?.trim() || null, startTime: s.startTime, endTime: s.endTime }))
              : null,
            targetThai: data.targetThai ?? true,
            targetInternational: data.targetInternational ?? true,
            quotaThai: data.quotaThai ?? null,
            quotaInternational: data.quotaInternational ?? null,
            firstYearOnly: data.firstYearOnly ?? false,
            staffUserIds,
            allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
            allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
            allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null,
            // Back to pending for staff to re-review; the prior rejection's
            // reviewer/note is cleared (the audit log below is the permanent
            // record of it, not this row).
            status: "pending",
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            updatedAt: new Date(),
          })
          .where(and(eq(eventProposals.id, id), eq(eventProposals.status, "rejected")))
          .returning({ id: eventProposals.id });

        if (!updated) {
          throw new AlreadyResolvedError();
        }

        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          action: `Resubmitted event proposal "${data.title}" (${id}) after rejection`,
          ipAddress: ip,
        });
      });

      return NextResponse.json({ success: true, status: "pending" });
    }

    const { reviewNote } = reviewActionSchema.parse(body);

    if (proposal.status !== "pending") {
      return NextResponse.json({ error: "This proposal has already been resolved" }, { status: 409 });
    }

    const newStatus = action === "reject" ? "rejected" : "withdrawn";
    const ip = getClientIp(req);

    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(eventProposals)
        .set({
          status: newStatus,
          reviewedBy: session.user!.id!,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(eventProposals.id, id), eq(eventProposals.status, "pending")))
        .returning({ id: eventProposals.id });

      if (!updated) {
        throw new AlreadyResolvedError();
      }

      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: `${action === "reject" ? "Rejected" : "Withdrew"} event proposal "${proposal.title}" (${id})`,
        ipAddress: ip,
      });
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    if (error instanceof AlreadyResolvedError) {
      return NextResponse.json({ error: "This proposal has already been resolved" }, { status: 409 });
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
