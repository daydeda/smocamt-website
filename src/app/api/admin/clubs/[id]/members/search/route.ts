import { auth } from "@/auth";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { effectiveRoles } from "@/lib/access/admin-access";
import { NextResponse } from "next/server";

// GET /api/admin/clubs/[id]/members/search?q=... — Search accounts to add to
// THIS club (any role — no student-only filter, by request). Gate:
// super_admin/admin, OR a club_president managing THEIR OWN club (verified
// server-side against club_members, same pattern as the other club routes).
// Deliberately its own minimal endpoint rather than reusing GET
// /api/admin/students: that route returns the full directory (house, system
// role, profileCompleted, major, ...) to staff roles only, and a club
// president adding someone to their own club has no legitimate need for any
// of that — so this returns only id/name/studentId, and only for a
// non-trivial query, so a club_president can never browse/enumerate the whole
// directory through this endpoint.
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

    if (!isAdminRole) {
      const isClubPresident = effectiveRoles(session.user.role, session.user.roles).includes("club_president");
      const ownClubIds = isClubPresident
        ? await ClubsService.getPresidentClubIds(session.user.id!)
        : [];
      if (!ownClubIds.includes(id)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return NextResponse.json([]);
    }

    const matches = await ClubsService.searchAccountsForMembership(q);

    return NextResponse.json(matches);
  } catch (error) {
    console.error("Failed to search students:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
