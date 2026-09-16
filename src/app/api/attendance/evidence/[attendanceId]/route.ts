import { auth } from "@/auth";
import { db } from "@/db";
import { attendance } from "@/db/schema";
import { downloadFormFile } from "@/lib/form-file-storage";
import { eq } from "drizzle-orm";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";

export const dynamic = "force-dynamic";

// Mirrors ADMIN_ROLES in /api/forms/file/[submissionId] — the same staff who
// can review form file answers. Deliberately NOT extended to scoped club/
// major presidents yet (unlike the attendance roster's medical-detail tier) —
// evidence check-in is currently only used for centrally-run campaigns; add
// EventScopeService scoping here if a president-run evidence event needs it.
const ADMIN_ROLES = ["super_admin", "admin", "registration", "organizer"];

// A stored key is always "<uuid>.<ext>" (see form-file-storage.ts, reused as-is
// for evidence uploads).
const KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/attendance/evidence/[attendanceId] — stream a student's evidence
// check-in photo/PDF. PDPA-gated: only the student who submitted it or staff
// may view it. Lives in the same private "form-uploads" bucket as form file
// answers and is proxied here, never a public URL.
export async function GET(req: Request, { params }: { params: Promise<{ attendanceId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { attendanceId } = await params;
    if (!UUID_PATTERN.test(attendanceId)) {
      return NextResponse.json({ error: "Invalid attendance id" }, { status: 400 });
    }

    const row = await db.query.attendance.findFirst({ where: eq(attendance.id, attendanceId) });
    if (!row || !row.evidenceFileKey) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isOwner = row.studentId === session.user.id;
    const isAdmin = ADMIN_ROLES.includes(session.user.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session.user.role, session.user.roles), session.user.smoPosition, session.user.anusmoPosition);
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const key = row.evidenceFileKey;
    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { buffer, contentType } = await downloadFormFile(key);

    // PDPA: a third-party admin viewing a student's evidence photo leaves a
    // trail (the owner viewing their own submission is not logged).
    // Best-effort — never block the view on an audit hiccup.
    if (isAdmin && !isOwner) {
      try {
        await AuditService.logAction({
          actorId: session.user.id!,
          targetId: row.studentId ?? undefined,
          action: `Viewed evidence check-in file (attendance ${attendanceId})`,
          ipAddress: getClientIp(req),
        });
      } catch (e) {
        console.error("Failed to audit evidence-file view:", e);
      }
    }

    const ext = key.slice(key.lastIndexOf("."));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${attendanceId}${ext}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Evidence file view error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
