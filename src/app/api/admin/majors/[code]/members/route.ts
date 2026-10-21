import { auth } from "@/auth";
import { effectiveRoles } from "@/lib/access/admin-access";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { MajorsService } from "@/modules/majors/majors.service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { NON_SMO_POSITION_IDS } from "@/lib/access/positions";
import { formatAuditTargetList } from "@/lib/util/audit-target-list";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";

const memberPositionSchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
  // Hardcoded to the 12 non-SMO ids — this surface's population is never
  // smo/anusmo by construction (a major team, not SMO staff), so
  // club_affairs is simply never offered here.
  position: z.enum(NON_SMO_POSITION_IDS).nullable(),
});

// GET /api/admin/majors/[code]/members — List the students belonging to a
// major: identity, contact info, house, position. Medical detail/emergency
// contacts are deliberately NOT included here (data minimization) — see GET
// .../members/[memberId]/medical, fetched + audit-logged per student only
// when a president actually expands that student's panel
// (MajorsService.getMajorMembers), for the major_president's Team panel and
// Event Staff picker on /admin/majors (mirrors GET
// /api/admin/clubs/[id]/members). Gate: super_admin/admin, OR a
// major_president viewing THEIR OWN major (verified server-side via
// EventScopeService.getPresidentScope, i.e. the president's own users.major —
// never trust the client-supplied :code alone). This carries substantial PII
// for every student in the major, so it must not be visible to another
// major's president or any role beyond the two that already manage student
// identities plus the major's own president. PDPA: the accountability
// mechanism for this broader-than-usual grant is the audit log below — every
// read is recorded, mirroring the event attendance-list read.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code } = await params;
    const isAdminRole = ["super_admin", "admin"].includes(session.user.role || "");

    if (!isAdminRole) {
      const myRoles = effectiveRoles(session.user.role, session.user.roles);
      const scope = await EventScopeService.getPresidentScope(session.user.id!, myRoles);
      if (!scope.majors.includes(code)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const members = await MajorsService.getMajorMembers(code);

    await AuditService.logAction({
      actorId: session.user.id!,
      targetId: formatAuditTargetList(members.map((m) => ({ name: m.name, studentId: m.studentId }))),
      action: `Viewed major team roster for major ${code} (${members.length} member(s), identity + contact info; medical detail/emergency contacts are fetched — and logged — per student on expand)`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(members);
  } catch (error) {
    console.error("Failed to fetch major members:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH /api/admin/majors/[code]/members — Set a major team member's
// `position` (staff title, src/lib/positions.ts). Gate: identical to GET —
// super_admin/admin, OR a major_president managing THEIR OWN major (verified
// server-side via EventScopeService.getPresidentScope — never trust the
// client-supplied :code alone).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code } = await params;
    const isAdminRole = ["super_admin", "admin"].includes(session.user.role || "");

    if (!isAdminRole) {
      const myRoles = effectiveRoles(session.user.role, session.user.roles);
      const scope = await EventScopeService.getPresidentScope(session.user.id!, myRoles);
      if (!scope.majors.includes(code)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => null);
    const data = memberPositionSchema.parse(body);

    const updated = await MajorsService.setMemberPosition(code, data.userId, data.position);
    if (!updated) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await AuditService.logAction({
      actorId: session.user.id!,
      targetId: data.userId,
      action: `Updated major team member position: ${data.position ?? "none"} (major ${code})`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, member: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", "),
      }, { status: 400 });
    }

    console.error("Failed to update major member position:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
