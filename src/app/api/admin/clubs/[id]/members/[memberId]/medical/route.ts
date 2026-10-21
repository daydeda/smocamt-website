import { auth } from "@/auth";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { effectiveRoles } from "@/lib/access/admin-access";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";

// GET /api/admin/clubs/[id]/members/[memberId]/medical — Medical detail +
// emergency contacts (relationship + phone only — the contact's own name is
// redacted at the DB layer, see ClubsService.getClubMemberMedical) for ONE
// member of this club. Split out of GET .../members (which returns identity/
// contact for the whole roster) as a data-minimization measure: this data
// only ever leaves the server, and only ever gets audit-logged, for the
// specific member a president actually expands — never the whole club on
// every page load. Gate: identical to GET .../members — super_admin/admin,
// or a club_president viewing THEIR OWN club (verified server-side against
// club_members — never trust the client-supplied :id alone).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, memberId } = await params;
    const isAdminRole = ["super_admin", "admin"].includes(session.user.role || "");

    if (!isAdminRole) {
      const isClubPresident = effectiveRoles(session.user.role, session.user.roles).includes("club_president");
      const ownClubIds = isClubPresident
        ? await ClubsService.getPresidentClubIds(session.user.id!)
        : [];
      if (!ownClubIds.includes(id)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const medical = await ClubsService.getClubMemberMedical(id, memberId);
    if (!medical) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const club = await ClubsService.getClubName(id);

    await AuditService.logAction({
      actorId: session.user.id!,
      targetId: memberId,
      action: `Viewed medical detail for "${medical.userName}" (${medical.studentId}) in club "${club?.name ?? id}" (${id})`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(medical);
  } catch (error) {
    console.error("Failed to fetch club member medical detail:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
