import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getClientIp } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
import { effectiveRoles } from "@/lib/access/admin-access";
import { RESET_STRIKES_ROLES } from "@/lib/points/strikes";

// POST /api/admin/students/[id]/strikes/reset — clears a student's no-show
// strikes and unblocks pre-registration. Narrower than the roles that can
// APPLY strikes (super_admin/admin only): a reset erases the deterrent, so it
// should be a deliberate staff decision, not something an event organizer can
// do to their own event's strikes. Does not refund already-deducted points —
// the point penalty is a separate, already-served consequence.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user || !myRoles.some((r) => (RESET_STRIKES_ROLES as readonly string[]).includes(r))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: targetStudentId } = await params;

    const target = await UsersService.getStrikeState(targetStudentId);
    if (!target) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await UsersService.resetStrikes(targetStudentId, target, session.user!.id!, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
