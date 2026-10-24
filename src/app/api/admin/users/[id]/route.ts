import { auth } from "@/auth";
import { composeFullName, hasInvalidNameChars, hasLatinLetters } from "@/lib/profile/name";
import { sanitizeAdminContacts } from "@/lib/pdpa/emergency-contacts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { POSITION_IDS } from "@/lib/access/positions";
import { effectiveRoles } from "@/lib/access/admin-access";

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

    // HN + issuing hospital: medical detail, so super_admin only (same gate as the read in
    // GET /api/admin/students/[id]). Only touched when the body carries it; an HN needs its
    // hospital name, and clearing the HN clears both.
    let hospitalNumber: string | null | undefined;
    let hospitalName: string | null | undefined;
    if (isSuperAdminActor && (typeof body.hospitalNumber === "string" || typeof body.hospitalName === "string")) {
      hospitalNumber = (typeof body.hospitalNumber === "string" ? body.hospitalNumber.trim().slice(0, 30) : "") || null;
      hospitalName = (typeof body.hospitalName === "string" ? body.hospitalName.trim().slice(0, 100) : "") || null;
      if (hospitalNumber && !hospitalName) {
        return NextResponse.json({ error: "hospitalNameRequired" }, { status: 400 });
      }
      if (!hospitalNumber) hospitalName = null;
    }

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
    const targetUser = await UsersService.findUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // Same letters-only rule as the student's own forms (src/lib/profile/name.ts). The admin
    // form re-sends the stored name on every save, so only a CHANGED name/nickname is checked:
    // an account whose old name already has a digit can still have its role etc. edited.
    if (
      (typeof name === "string" && name !== targetUser.name && hasInvalidNameChars(name)) ||
      (typeof nickname === "string" && nickname !== targetUser.nickname && hasInvalidNameChars(nickname))
    ) {
      return NextResponse.json({ error: "nameInvalidChars" }, { status: 400 });
    }
    // Split name (first/last required, middle optional). `name` is rebuilt from the parts so every
    // reader of users.name keeps working. A name in Latin letters is confirmed by the admin
    // (latinNameConfirmed) so the student isn't forced to retype it in Thai; a Thai name leaves the
    // flag as it was. Saving parts clears the "please confirm your name" flag.
    let nameFields: Record<string, unknown> | undefined;
    if (typeof body.firstName === "string" || typeof body.lastName === "string" || typeof body.middleName === "string") {
      const firstName = String(body.firstName ?? "").trim().slice(0, 100);
      const middleName = String(body.middleName ?? "").trim().slice(0, 100);
      const lastName = String(body.lastName ?? "").trim().slice(0, 100);
      const incomplete = !firstName || !lastName;
      // A legacy one-word name (e.g. a staff nickname) the admin did not touch has no last name to
      // offer: leave it alone so unrelated edits (role, house...) still save. Changing it to
      // something else still needs both parts.
      if (incomplete && composeFullName({ firstName, middleName, lastName }) !== targetUser.name) {
        return NextResponse.json({ error: "nameRequired" }, { status: 400 });
      }
      if (!incomplete && [firstName, middleName, lastName].some(hasInvalidNameChars)) {
        return NextResponse.json({ error: "nameInvalidChars" }, { status: 400 });
      }
      if (!incomplete) nameFields = {
        name: composeFullName({ firstName, middleName, lastName }),
        firstName,
        middleName: middleName || null,
        lastName,
        nameNeedsReview: false,
        ...([firstName, middleName, lastName].some(hasLatinLetters) ? { latinNameConfirmed: true } : {}),
      };
    }

    // Emergency contacts are medical-adjacent PII: super_admin only (the same gate as reading them
    // in GET /api/admin/students/[id]), and only touched when the body carries them, so an
    // unrelated edit never blanks them.
    let emergencyContacts: unknown;
    if (isSuperAdminActor && Array.isArray(body.emergencyContacts)) {
      const result = sanitizeAdminContacts(body.emergencyContacts);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      emergencyContacts = result.contacts;
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
    if (nameFields && nameFields.name !== targetUser.name) changes.push("name");
    else if (!nameFields && name !== undefined && name !== targetUser.name) changes.push("name");
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
    // Field names only, like the self-edit trail (no medical values in the log).
    // Field name only, like the other medical fields: no contact values in the audit log.
    if (emergencyContacts !== undefined && JSON.stringify(emergencyContacts) !== JSON.stringify(targetUser.emergencyContacts ?? [])) {
      changes.push("emergencyContacts");
    }
    if (hospitalNumber !== undefined && hospitalNumber !== targetUser.hospitalNumber) changes.push("hospitalNumber");
    if (hospitalName !== undefined && hospitalName !== targetUser.hospitalName) changes.push("hospitalName");

    // Club presidencies: diff against the CURRENT set so the audit note only
    // fires on a real change. The actual club_members write happens inside the
    // SAME transaction as the users update (via ClubsService.setUserClubPresidencies(tx)
    // below) so a failure can't leave a committed audit entry describing a
    // presidency change that never actually landed.
    let oldClubIds: string[] = [];
    if (clubIds !== undefined) {
      oldClubIds = (await ClubsService.getPresidentClubIds(userId)).sort();
      const newClubIds = [...clubIds].sort();
      if (JSON.stringify(newClubIds) !== JSON.stringify(oldClubIds)) {
        changes.push(`clubs: [${oldClubIds.join(", ")}] → [${newClubIds.join(", ")}]`);
      }
    }

    await UsersService.updateUserByAdmin({
      userId,
      targetUserName: targetUser.name,
      fields: {
        name,
        ...nameFields,
        emergencyContacts: emergencyContacts as typeof targetUser.emergencyContacts | undefined,
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
        hospitalNumber,
        hospitalName,
      },
      clubIds,
      changes,
      actorId: session.user.id!,
      ipAddress: getClientIp(req),
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
    const targetUser = await UsersService.findUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (targetUser.role === "super_admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden: Cannot delete Super Admin accounts" }, { status: 403 });
    }

    await UsersService.deleteUserByAdmin(userId, targetUser, session.user.id!, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
