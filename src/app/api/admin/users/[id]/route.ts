import { auth } from "@/auth";
import { db } from "@/db";
import { users, attendance, clubMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { POSITION_IDS } from "@/lib/positions";
import { effectiveRoles } from "@/lib/admin-access";

// Every role the system recognizes, highest-privilege first. Used both to derive
// the primary `role` from a roles[] set and (via roleEnum) to validate incoming
// role assignments so a crafted request can't write an unknown/arbitrary role.
const ROLE_PRIORITY = [
  "super_admin",
  "admin",
  "registration",
  "organizer",
  "smo",
  "anusmo",
  "club_president",
  "major_president",
  "shop_seller",
  "staff",
  "professor",
  "officer",
  "student",
] as const;
const roleEnum = z.enum(ROLE_PRIORITY);

// Only the privilege-bearing role fields are validated here; the other editable
// fields (name, prefix, …) are read from the body as-is below. Both optional and
// nullable so a partial update that doesn't touch roles still passes.
const userRoleSchema = z.object({
  role: roleEnum.optional().nullable(),
  roles: z.array(roleEnum).optional().nullable(),
  // Which clubs this user presides over (club_president identity — see
  // EventScopeService). Only meaningful alongside a club_president role; the
  // admin students page only sends this when the club_president checkbox is
  // shown, but any caller may send [] to clear all presidencies for this user.
  clubIds: z.array(z.string().uuid()).optional(),
  // SMO/ANUSMO staff titles (src/lib/positions.ts) — distinct from role/roles
  // above, and scoped independently: a user can hold both smo and anusmo at
  // once with a different title in each. Club titles are set per-club via
  // ClubsService (admin/clubs's Members modal); major titles via MajorsService
  // (admin/majors's Team panel) — neither goes through this route. Validated
  // here (not read as-is from body) so a bad value 400s instead of silently
  // writing garbage.
  smoPosition: z.enum(POSITION_IDS).optional().nullable(),
  anusmoPosition: z.enum(POSITION_IDS).optional().nullable(),
});

// PATCH: Update user information or role
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !["super_admin", "admin"].includes(session.user.role || "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Validate the privilege-bearing role fields against the known role set before
    // writing them; everything else is read from the body as-is.
    const parsedRoles = userRoleSchema.safeParse(body);
    if (!parsedRoles.success) {
      return NextResponse.json({ error: "Invalid role assignment" }, { status: 400 });
    }

    // Fields that can be updated by admin
    const { name, prefix, major, houseId, studentId, nickname } = body;
    let { role, roles } = parsedRoles.data;
    const { clubIds, smoPosition, anusmoPosition } = parsedRoles.data;

    // Contact info (phone/contactChannels) is only ever writable by
    // super_admin, mirroring the read-side gate in GET /api/admin/students —
    // a crafted request from an admin/registration actor must not be able to
    // smuggle these fields in even though the route otherwise allows admin.
    const isSuperAdminActor = effectiveRoles(session.user.role, session.user.roles).includes("super_admin");
    // phone is unique-but-nullable in the schema — normalize "" to null so
    // clearing it for one user can't collide with another user's empty string.
    const phone = isSuperAdminActor && typeof body.phone === "string" ? (body.phone.trim() || null) : undefined;
    const contactChannels = isSuperAdminActor && typeof body.contactChannels === "string" ? body.contactChannels : undefined;

    if (roles && Array.isArray(roles)) {
      // Find the primary role based on priority
      const roleSet = roles;
      const primary = ROLE_PRIORITY.find((r) => roleSet.includes(r));
      role = primary || roleSet[0] || "student";
    } else if (role) {
      // If only single role is provided, make sure roles array contains it
      roles = [role];
    }

    // FE-Security: non-super_admin cannot award super_admin role
    const isAssigningSuperAdmin = role === "super_admin" || (roles && roles.includes("super_admin"));
    if (isAssigningSuperAdmin && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden: Only Super Admins can assign the Super Admin role" }, { status: 403 });
    }

    // FE-Security: non-super_admin cannot edit a super_admin user
    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const isTargetSuperAdmin = targetUser.role === "super_admin" || (targetUser.roles as string[] | null)?.includes("super_admin");
    if (isTargetSuperAdmin && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden: Cannot edit Super Admin accounts" }, { status: 403 });
    }

    // Major-position lock: a major_president's title is always "President" —
    // nobody, including super_admin, may set it to anything else (mirrors the
    // same invariant MajorsService.setMemberPosition enforces on the
    // major-scoped president's own editing surface, and ClubsService's
    // equivalent for club_members.position — that one lives entirely in
    // ClubsService now, since a club_members row exists to hold it). Evaluated
    // against the FINAL role set (this request's `roles` if provided, else the
    // user's current one) so an unrelated field-only edit still re-asserts it,
    // and losing the role releases a stale "president" title back to unset.
    const finalRoles = roles ?? ((targetUser.roles as string[] | null) ?? (targetUser.role ? [targetUser.role] : []));
    const willBeMajorPresident = finalRoles.includes("major_president");
    let majorPosition: string | null | undefined;
    if (willBeMajorPresident) {
      majorPosition = "president";
    } else if (targetUser.majorPosition === "president") {
      majorPosition = null;
    }

    // Build the audit summary: role changes are logged with old → new values,
    // other fields by name only (no PII values in the log itself).
    const changes: string[] = [];
    if (role !== undefined && role !== targetUser.role) {
      changes.push(`role: ${targetUser.role} → ${role}`);
    }
    const oldRoles = ((targetUser.roles as string[] | null) ?? []).slice().sort();
    const newRoles = roles ? (roles as string[]).slice().sort() : null;
    if (newRoles && JSON.stringify(newRoles) !== JSON.stringify(oldRoles)) {
      changes.push(`roles: [${oldRoles.join(", ")}] → [${newRoles.join(", ")}]`);
    }
    if (name !== undefined && name !== targetUser.name) changes.push("name");
    if (prefix !== undefined && prefix !== targetUser.prefix) changes.push("prefix");
    if (major !== undefined && major !== targetUser.major) changes.push("major");
    if (houseId !== undefined && houseId !== targetUser.houseId) changes.push("houseId");
    if (studentId !== undefined && studentId !== targetUser.studentId) changes.push("studentId");
    if (nickname !== undefined && nickname !== targetUser.nickname) changes.push("nickname");
    if (smoPosition !== undefined && smoPosition !== targetUser.smoPosition) {
      changes.push(`smoPosition: ${targetUser.smoPosition ?? "none"} → ${smoPosition ?? "none"}`);
    }
    if (anusmoPosition !== undefined && anusmoPosition !== targetUser.anusmoPosition) {
      changes.push(`anusmoPosition: ${targetUser.anusmoPosition ?? "none"} → ${anusmoPosition ?? "none"}`);
    }
    if (majorPosition !== undefined && majorPosition !== targetUser.majorPosition) {
      changes.push(`majorPosition: ${targetUser.majorPosition ?? "none"} → ${majorPosition ?? "none"}`);
    }
    if (phone !== undefined && phone !== targetUser.phone) changes.push("phone");
    if (contactChannels !== undefined && contactChannels !== targetUser.contactChannels) changes.push("contactChannels");

    // Club presidencies: diff against the CURRENT set so the audit note only
    // fires on a real change. The actual club_members write happens inside the
    // SAME transaction as the users update (via ClubsService.setUserClubPresidencies(tx)
    // below) so a failure can't leave a committed audit entry describing a
    // presidency change that never actually landed.
    let oldClubIds: string[] = [];
    if (clubIds !== undefined) {
      const currentPresidencies = await db
        .select({ clubId: clubMembers.clubId })
        .from(clubMembers)
        .where(and(eq(clubMembers.userId, userId), eq(clubMembers.role, "president")));
      oldClubIds = currentPresidencies.map((c) => c.clubId).sort();
      const newClubIds = [...clubIds].sort();
      if (JSON.stringify(newClubIds) !== JSON.stringify(oldClubIds)) {
        changes.push(`clubs: [${oldClubIds.join(", ")}] → [${newClubIds.join(", ")}]`);
      }
    }

    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({
          name,
          prefix,
          role,
          roles,
          major,
          houseId,
          studentId,
          nickname,
          majorPosition,
          smoPosition,
          anusmoPosition,
          phone,
          contactChannels,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      if (clubIds !== undefined) {
        await ClubsService.setUserClubPresidencies(userId, clubIds, tx);
      }

      if (changes.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: session.user.id!,
          targetId: userId,
          action: `Updated user ${targetUser.name}: ${changes.join(", ")}`,
          ipAddress: getClientIp(req),
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE: Remove user
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !["super_admin", "admin"].includes(session.user.role || "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;

    // Prevent self-deletion
    if (userId === session.user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    // FE-Security: non-super_admin cannot delete a super_admin user
    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (targetUser.role === "super_admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden: Cannot delete Super Admin accounts" }, { status: 403 });
    }

    // Some foreign keys referencing users.id lack ON DELETE CASCADE in the
    // production schema (attendance.student_id / scanned_by). Clean those up in
    // a transaction first, otherwise Postgres rejects the delete with a FK
    // violation. accounts / sessions / authenticators / form_submissions
    // already cascade. audit_logs rows are NEVER rewritten — their actor_id /
    // target_id values are baked into the tamper-evident row hashes, so the
    // FK constraints on audit_logs were dropped instead (migration step 27).
    await db.transaction(async (tx) => {
      // Remove this user's own event registrations/attendance.
      await tx.delete(attendance).where(eq(attendance.studentId, userId));
      // Preserve other students' attendance that this user scanned in.
      await tx.update(attendance).set({ scannedBy: null }).where(eq(attendance.scannedBy, userId));

      await tx.delete(users).where(eq(users.id, userId));

      // PDPA erasure record. The name/studentId live in the action text since
      // the target user row no longer exists to join against.
      await AuditService.logActionInternal(tx, {
        actorId: session.user.id!,
        targetId: userId,
        action: `Deleted user account: ${targetUser.name}${targetUser.studentId ? ` (${targetUser.studentId})` : ""}`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
