import { auth } from "@/auth";
import { effectiveRoles } from "@/lib/access/admin-access";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { MajorsService } from "@/modules/majors/majors.service";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";

// GET /api/admin/majors/[code]/members/[memberId]/medical — Medical detail +
// emergency contacts (relationship + phone only — the contact's own name is
// redacted at the DB layer, see MajorsService.getMajorMemberMedical) for ONE
// student in this major. Split out of GET .../members (which returns
// identity/contact for the whole roster) as a data-minimization measure:
// this data only ever leaves the server, and only ever gets audit-logged,
// for the specific student a president actually expands — never the whole
// major on every page load. Gate: identical to GET .../members —
// super_admin/admin, or a major_president viewing THEIR OWN major (verified
// server-side via EventScopeService.getPresidentScope — never trust the
// client-supplied :code alone).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string; memberId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code, memberId } = await params;
    const isAdminRole = ["super_admin", "admin"].includes(session.user.role || "");

    if (!isAdminRole) {
      const myRoles = effectiveRoles(session.user.role, session.user.roles);
      const scope = await EventScopeService.getPresidentScope(session.user.id!, myRoles);
      if (!scope.majors.includes(code)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const medical = await MajorsService.getMajorMemberMedical(code, memberId);
    if (!medical) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await AuditService.logAction({
      actorId: session.user.id!,
      targetId: memberId,
      action: `Viewed medical detail for "${medical.name}" (${medical.studentId}) in major ${code}`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(medical);
  } catch (error) {
    console.error("Failed to fetch major member medical detail:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
