import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
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

    const target = await db.query.users.findFirst({
      where: eq(users.id, targetStudentId),
      columns: { id: true, noShowCount: true, registrationBlocked: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ noShowCount: 0, registrationBlocked: false })
        .where(eq(users.id, targetStudentId));

      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        targetId: targetStudentId,
        action: `Reset no-show strikes (was ${target.noShowCount}/3${target.registrationBlocked ? ", blocked" : ""})`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
