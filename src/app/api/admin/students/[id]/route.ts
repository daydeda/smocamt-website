import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getClientIp } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
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

    const studentData = await UsersService.getStudentSensitiveDetail(targetStudentId, session.user.id!, getClientIp(req));

    if (!studentData) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json(studentData);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
