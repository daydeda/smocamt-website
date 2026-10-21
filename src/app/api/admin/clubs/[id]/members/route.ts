import { auth } from "@/auth";
import { db } from "@/db";
import { clubs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { effectiveRoles } from "@/lib/access/admin-access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { NON_SMO_POSITION_IDS } from "@/lib/access/positions";
import { formatAuditTargetList } from "@/lib/util/audit-target-list";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";

const memberBodySchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
});

const memberPositionSchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
  // Hardcoded to the 12 non-SMO ids — this surface's population is never
  // smo/anusmo by construction (club membership, not SMO staff), so
  // club_affairs is simply never offered here.
  position: z.enum(NON_SMO_POSITION_IDS).nullable(),
});

// Shared by POST/DELETE: super_admin/admin may manage any club; a
// club_president may manage ONLY their own club(s), verified server-side
// against club_members (never trust the client-supplied :id alone). Gates on
// the full role SET, not just the primary role — see the matching comment on
// GET below for why.
async function canManageClubMembers(
  session: { user?: { role?: string | null; roles?: string[] | null; id?: string | null } } | null,
  clubId: string,
): Promise<boolean> {
  if (!session?.user) return false;
  if (["super_admin", "admin"].includes(session.user.role || "")) return true;
  const isClubPresident = effectiveRoles(session.user.role, session.user.roles).includes("club_president");
  if (!isClubPresident) return false;
  const ownClubIds = await ClubsService.getPresidentClubIds(session.user.id!);
  return ownClubIds.includes(clubId);
}

// GET /api/admin/clubs/[id]/members — List a club's members: identity, contact
// info, house, position. Medical detail/emergency contacts are deliberately
// NOT included here (data minimization) — see GET .../members/[memberId]/medical,
// fetched + audit-logged per member only when a president actually expands
// that member's panel (ClubsService.getClubMembers). Gate:
// super_admin/admin, OR a club_president viewing THEIR OWN club (verified
// server-side against club_members — never trust the client-supplied :id
// alone). A member roster carries substantial PII for every club, so it must
// not be visible to another club's president or to any role beyond the two
// that already manage club identities plus the club's own president. PDPA:
// the accountability mechanism for this broader-than-usual grant is the audit
// log below — every read is recorded, mirroring the event attendance-list read.
//
// Below that sits a THIRD, narrower tier: a non-president staff-position
// holder (e.g. secretary, finance — any NON_SMO_POSITION_IDS title short of
// "president") viewing THEIR OWN club as a plain member (verified against
// club_members' role='member' rows, same never-trust-the-client-id pattern)
// gets ClubsService.getClubMembersLimited instead — identity, major, house,
// position, but no phone/contactChannels, and no medical/export access at
// all (those routes' own gates are untouched, so this tier never reaches
// them regardless of what the client renders).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isAdminRole = ["super_admin", "admin"].includes(session.user.role || "");

    let isOwnClub = isAdminRole;
    if (!isOwnClub) {
      // Gate on the full role SET, not just the primary role — see the matching
      // comment in GET /api/admin/clubs for why (a club_president who is also
      // e.g. smo resolves session.user.role to "smo").
      const isClubPresident = effectiveRoles(session.user.role, session.user.roles).includes("club_president");
      const ownClubIds = isClubPresident
        ? await ClubsService.getPresidentClubIds(session.user.id!)
        : [];
      isOwnClub = ownClubIds.includes(id);
    }

    if (isOwnClub) {
      const members = await ClubsService.getClubMembers(id);
      const club = await db.query.clubs.findFirst({ where: eq(clubs.id, id), columns: { name: true } });

      await AuditService.logAction({
        actorId: session.user.id!,
        targetId: formatAuditTargetList(members.map((m) => ({ name: m.userName, studentId: m.studentId }))),
        action: `Viewed club member roster for club "${club?.name ?? id}" (${id}) — ${members.length} member(s) (identity + contact info; medical detail/emergency contacts are fetched — and logged — per member on expand)`,
        ipAddress: getClientIp(req),
      });

      return NextResponse.json(members);
    }

    // Not admin-tier and not this club's president: fall through to the
    // narrower staff-position tier, scoped to their own plain membership.
    const hasStaffPosition = !!session.user.hasClubPosition;
    const staffClubIds = hasStaffPosition
      ? await ClubsService.getStaffMemberClubIds(session.user.id!)
      : [];
    if (!staffClubIds.includes(id)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const members = await ClubsService.getClubMembersLimited(id);
    const club = await db.query.clubs.findFirst({ where: eq(clubs.id, id), columns: { name: true } });

    await AuditService.logAction({
      actorId: session.user.id!,
      targetId: formatAuditTargetList(members.map((m) => ({ name: m.userName, studentId: m.studentId }))),
      action: `Viewed club member roster (limited view — no contact info, no medical/export access) for club "${club?.name ?? id}" (${id}) — ${members.length} member(s)`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(members);
  } catch (error) {
    console.error("Failed to fetch club members:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/clubs/[id]/members — Add a user to this club as a plain
// 'member'. Gate: super_admin/admin (any club), or a club_president managing
// THEIR OWN club. There is deliberately no way to grant 'president' here: that
// role must go through the Students page's role editor
// (setUserClubPresidencies), which keeps the club_members row in sync with the
// user's club_president system role tag — doing it here would let someone end
// up "president" of a club with no actual club_president role (or let a club
// president silently promote themselves/others).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id } = await params;
    if (!(await canManageClubMembers(session, id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const data = memberBodySchema.parse(body);

    const member = await ClubsService.addClubMember(id, data.userId);
    if (!member) {
      return NextResponse.json({ error: "User or club not found" }, { status: 404 });
    }

    await AuditService.logAction({
      actorId: session!.user!.id!,
      targetId: data.userId,
      action: `Added club member ${data.userId} to club ${id}`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", "),
      }, { status: 400 });
    }

    // FK violation: clubId or userId doesn't exist.
    const dbError = error instanceof Error && error.cause ? error.cause : error;
    if (dbError && typeof dbError === "object" && "code" in dbError && dbError.code === "23503") {
      return NextResponse.json({ error: "User or club not found" }, { status: 404 });
    }

    console.error("Failed to add club member:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/admin/clubs/[id]/members — Remove a plain 'member' from this
// club. Gate: super_admin/admin (any club), or a club_president managing THEIR
// OWN club. Deliberately refuses to remove a role='president' row (even their
// own) — presidency must be revoked via the Students page's role editor (which
// un-checks club_president and clears the matching club_members row
// together), so this stays the one path that can desync a club_president
// system role from an actual club_members presidency.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id } = await params;
    if (!(await canManageClubMembers(session, id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const data = memberBodySchema.parse(body);

    const members = await ClubsService.getClubMembers(id);
    const target = members.find((m) => m.userId === data.userId);
    if (!target) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (target.role === "president") {
      return NextResponse.json({
        error: "Can't remove a president here — revoke the club_president role from the Students page instead",
      }, { status: 409 });
    }

    await ClubsService.removeClubMember(id, data.userId);

    await AuditService.logAction({
      actorId: session!.user!.id!,
      targetId: data.userId,
      action: `Removed club member ${data.userId} from club ${id}`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", "),
      }, { status: 400 });
    }

    console.error("Failed to remove club member:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH /api/admin/clubs/[id]/members — Set a club member's `position`
// (staff title, src/lib/positions.ts — distinct from this row's 'member'/
// 'president' club role). Gate: identical to POST/DELETE — super_admin/admin
// (any club), or a club_president managing THEIR OWN club.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id } = await params;
    if (!(await canManageClubMembers(session, id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const data = memberPositionSchema.parse(body);

    const updated = await ClubsService.setMemberPosition(id, data.userId, data.position);
    if (!updated) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await AuditService.logAction({
      actorId: session!.user!.id!,
      targetId: data.userId,
      action: `Updated club member position: ${data.position ?? "none"} (club ${id})`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, member: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", "),
      }, { status: 400 });
    }

    console.error("Failed to update club member position:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
