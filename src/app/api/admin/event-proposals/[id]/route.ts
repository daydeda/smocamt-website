import { auth } from "@/auth";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { REVIEW_PROPOSAL_ROLES } from "@/lib/events/event-proposals";
import { sessionsHaveInvalidSpan } from "@/lib/events/event-schema";
import { getClientIp } from "@/modules/audit/audit.service";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { AlreadyResolvedError, EventProposalsService } from "@/modules/events/event-proposals.service";
import { MajorsService } from "@/modules/majors/majors.service";
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
    const proposal = await EventProposalsService.getProposalDetail(id);
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

    const proposal = await EventProposalsService.getProposalForAction(id);
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
      await EventProposalsService.resubmitProposal(id, data, staffUserIds, session.user.id!, ip);

      return NextResponse.json({ success: true, status: "pending" });
    }

    const { reviewNote } = reviewActionSchema.parse(body);

    if (proposal.status !== "pending") {
      return NextResponse.json({ error: "This proposal has already been resolved" }, { status: 409 });
    }

    const newStatus = action === "reject" ? "rejected" : "withdrawn";
    const ip = getClientIp(req);

    await EventProposalsService.resolveProposal({
      id,
      action,
      newStatus,
      reviewNote,
      title: proposal.title,
      reviewerId: session.user!.id!,
      ipAddress: ip,
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
