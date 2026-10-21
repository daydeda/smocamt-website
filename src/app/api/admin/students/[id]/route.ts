import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { effectiveRoles } from "@/lib/access/admin-access";

// Next.js 15+: params is a Promise and must be awaited
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !effectiveRoles(session.user.role, session.user.roles).includes("super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: targetStudentId } = await params;

    // FE-12: Log the sensitive data access (Immutable Audit Trail)
    await AuditService.logAction({
      actorId: session.user.id!,
      targetId: targetStudentId,
      action: "Viewed Sensitive Medical/Emergency Info",
      ipAddress: getClientIp(req),
    });

    const studentData = await db.query.users.findFirst({
      where: eq(users.id, targetStudentId),
      // qrToken is a permanent check-in credential replayable at /api/admin/scan,
      // so it must never leave the server — every other route strips it too.
      columns: { qrToken: false },
      with: { house: true },
    });

    if (!studentData) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json(studentData);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
