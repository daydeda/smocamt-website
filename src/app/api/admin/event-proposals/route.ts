import { auth } from "@/auth";
import { db } from "@/db";
import { eventProposals } from "@/db/schema";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";
import { REVIEW_PROPOSAL_ROLES, SUBMIT_PROPOSAL_ROLES } from "@/lib/event-proposals";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { EventProposalsService } from "@/modules/events/event-proposals.service";
import { MajorsService } from "@/modules/majors/majors.service";
import { majorsForFaculty, DEFAULT_FACULTY } from "@/lib/faculties";
import { getProposalReviewerUserIds } from "@/modules/notifications/push-audience";
import { PushService } from "@/modules/notifications/push.service";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { sessionsHaveInvalidSpan } from "@/lib/event-schema";

export const dynamic = "force-dynamic";

// The only valid major codes a major_president may propose for — same list
// users.major/events.ownerMajors draw from (see src/lib/faculties.ts).
const VALID_MAJOR_CODES = majorsForFaculty(DEFAULT_FACULTY);

const proposalCreateSchema = z
  .object({
    // Exactly one of clubId (club_president) / majorCode (major_president) is
    // set — enforced by the .refine below, not a DB constraint (see
    // eventProposals.clubId/majorCode in schema.ts).
    clubId: z.string().uuid().optional(),
    majorCode: z.enum(VALID_MAJOR_CODES as [string, ...string[]]).optional(),
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
    // Suggested multi-day schedule — see eventProposals.sessions in schema.ts.
    // No `id` field (unlike sessionInputSchema): these are always brand new
    // suggestions, never edits of existing eventSessions rows.
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
    // Suggested only — must be members of the SAME clubId, re-verified
    // server-side below (never trust the client-sent id list alone).
    staffUserIds: z.array(z.string()).optional().nullable(),
    // Suggested participant-eligibility ACL — mirrors events.allowedRoles/
    // allowedMajors/allowedClubs. Entirely non-binding: staff reviews/adjusts
    // these explicitly when creating the real event (see the fromProposal
    // prefill in admin/events/page.tsx) — never applied directly.
    allowedRoles: z.array(z.string()).optional().nullable(),
    allowedMajors: z.array(z.string()).optional().nullable(),
    allowedClubs: z.array(z.string().uuid()).optional().nullable(),
  })
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })
  .refine(
    // Mirrors eventSchema (see /api/admin/events): only fires with an
    // EXPLICIT per-day schedule (2+ session rows) where one row itself spans
    // multiple days. A plain startTime/endTime with no sessions (or a single
    // session) may legitimately span several days on purpose — e.g. a
    // multi-day camp that only needs ONE check-in for the whole event rather
    // than a check-in per day. See sessionsHaveInvalidSpan.
    (d) => !d.sessions || !sessionsHaveInvalidSpan(d.sessions),
    {
      message: "Each day in a per-day schedule must start and end on the same calendar day — add each additional day as its own row instead of stretching one across several dates",
      path: ["endTime"],
    },
  )
  .refine((d) => (d.clubId ? 1 : 0) + (d.majorCode ? 1 : 0) === 1, {
    message: "Exactly one of clubId or majorCode is required",
    path: ["clubId"],
  });

// GET /api/admin/event-proposals — list proposals. Staff (REVIEW_PROPOSAL_ROLES)
// see every proposal, optionally filtered by ?status=. A club_president sees
// only proposals for clubs they preside over (scoped via
// EventScopeService.getPresidentScope, same scope object events/appeals use —
// never trust a client-sent clubId). No pagination for v1, mirroring the
// existing /api/admin/appeals precedent at this data volume.
//
// ?type=club|major further restricts to only club-owned or only major-owned
// rows — used by /admin/clubs and /admin/majors respectively so a user who
// holds both club_president and major_president never sees the other type's
// proposals mixed into a page that has no UI to render them correctly.
export async function GET(req: Request) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    // Reviewing proposals is a staff-side capability with no club/major-scoped
    // equivalent (a club's own registration officer reviewing their own club's
    // proposal is a self-review loop) — only a GLOBAL registration position
    // (smo/anusmo) gets reviewer parity here, same as event creation/edit.
    const isStaff = myRoles.some((r) => (REVIEW_PROPOSAL_ROLES as readonly string[]).includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    const isPresident = myRoles.some((r) => (SUBMIT_PROPOSAL_ROLES as readonly string[]).includes(r));
    if (!session?.user || (!isStaff && !isPresident)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");

    const proposals = await EventProposalsService.listForViewer(session.user.id!, myRoles, isStaff, status, type);
    return NextResponse.json(proposals);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/event-proposals — a club_president requests an event for a
// club they preside over, or a major_president requests one for their own
// major. All requested fields (title/time/location/quota/audience/poster/
// staff/etc.) are non-binding suggestions: staff still explicitly sets
// pointsAwarded/allowedRoles/allowedMajors/managedByRoles/ownerClubIds/
// ownerMajors when creating the real event (see POST /api/admin/events'
// proposalId linkage) — nothing sensitive becomes self-service here, and the
// suggested staffUserIds can only be drawn from the proposer's own club
// roster, or from the proposer's own major (via users.major — see
// MajorsService.getMajorMembers), never the global student directory.
export async function POST(req: Request) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user || !myRoles.some((r) => (SUBMIT_PROPOSAL_ROLES as readonly string[]).includes(r))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = proposalCreateSchema.parse(await req.json());

    // Never trust a client-sent clubId/majorCode — it must be one this
    // president actually presides over/represents.
    let staffUserIds: string[] | null = null;
    if (data.clubId) {
      const inScope = await EventProposalsService.isClubInScope(session.user.id!, myRoles, data.clubId);
      if (!inScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const club = await EventProposalsService.getClub(data.clubId);
      if (!club) {
        return NextResponse.json({ error: "Club not found" }, { status: 404 });
      }
      if (club.isArchived) {
        return NextResponse.json({ error: "This club has been archived" }, { status: 400 });
      }

      // Never trust the client-sent staffUserIds — strip anyone who isn't
      // actually a member of THIS club (the only roster the proposer can see).
      if (data.staffUserIds && data.staffUserIds.length > 0) {
        const members = await ClubsService.getClubMembers(data.clubId);
        const memberIds = new Set(members.map((m) => m.userId));
        const filtered = data.staffUserIds.filter((id) => memberIds.has(id));
        staffUserIds = filtered.length > 0 ? filtered : null;
      }
    } else {
      const inScope = await EventProposalsService.isMajorInScope(session.user.id!, myRoles, data.majorCode!);
      if (!inScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Never trust the client-sent staffUserIds — strip anyone who isn't
      // actually a student in THIS major (the only roster the proposer can see).
      if (data.staffUserIds && data.staffUserIds.length > 0) {
        const members = await MajorsService.getMajorMembers(data.majorCode!);
        const memberIds = new Set(members.map((m) => m.id));
        const filtered = data.staffUserIds.filter((id) => memberIds.has(id));
        staffUserIds = filtered.length > 0 ? filtered : null;
      }
    }

    const ip = getClientIp(req);
    const created = await db.transaction(async (tx) => {
      const [proposal] = await tx
        .insert(eventProposals)
        .values({
          clubId: data.clubId ?? null,
          majorCode: data.majorCode ?? null,
          proposedBy: session.user!.id!,
          title: data.title,
          description: data.description,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null,
          registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null,
          location: data.location,
          quota: data.quota,
          imageUrl: data.imageUrls?.[0] ?? data.imageUrl ?? null,
          imageUrls: data.imageUrls ?? (data.imageUrl ? [data.imageUrl] : null),
          walkInsEnabled: data.walkInsOnly ? true : (data.walkInsEnabled ?? false),
          walkInsOnly: data.walkInsOnly ?? false,
          quotaWalkIn: data.quotaWalkIn,
          registrationMode: data.registrationMode ?? "once",
          sessions: data.sessions && data.sessions.length > 0
            ? data.sessions.map((s) => ({ title: s.title?.trim() || null, startTime: s.startTime, endTime: s.endTime }))
            : null,
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          quotaThai: data.quotaThai,
          quotaInternational: data.quotaInternational,
          firstYearOnly: data.firstYearOnly ?? false,
          staffUserIds,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null,
        })
        .returning();

      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: data.clubId
          ? `Submitted event proposal "${proposal.title}" for club ${data.clubId}`
          : `Submitted event proposal "${proposal.title}" for major ${data.majorCode}`,
        ipAddress: ip,
      });

      return proposal;
    });

    // Runs after the response is sent — a push send must never add latency to
    // (or fail) the proposal submission itself.
    after(async () => {
      const reviewerIds = await getProposalReviewerUserIds();
      await PushService.sendToUserIds(reviewerIds, {
        title: "New event proposal",
        body: `"${created.title}" is waiting for review.`,
        url: "/admin/proposals",
        tag: `proposal:${created.id}`,
      });
    });

    return NextResponse.json({ success: true, proposal: created }, { status: 201 });
  } catch (error) {
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
