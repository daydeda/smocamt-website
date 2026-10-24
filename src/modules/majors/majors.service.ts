import { db } from "@/db";
import { houses, users } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { redactEmergencyContacts } from "@/lib/pdpa/emergency-contacts";

export class MajorsService {
  /**
   * Lists the students belonging to a major — the major analogue of
   * ClubsService.getClubMembers. Majors have no roster table like
   * club_members; "membership" is just users.major, so this doubles as both
   * the Event Staff picker's source and the server-side re-verification of a
   * proposal's suggested staffUserIds. Beyond identity (name/studentId) it
   * also returns contact info, house, and whether this row IS the major's
   * president (roles includes major_president) — the major_president-only
   * Team panel uses that to lock their own position to "President" (see
   * setMemberPosition below). Medical detail/emergency contacts are
   * deliberately NOT included here (data minimization) — see
   * getMajorMemberMedical, fetched per-student on demand only when a
   * president expands that one student's panel. Use getMajorMembersFull for
   * a genuine bulk pull (the .xlsx export).
   */
  static async getMajorMembers(majorCode: string) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        phone: users.phone,
        contactChannels: users.contactChannels,
        noShowCount: users.noShowCount,
        roles: users.roles,
        position: users.majorPosition,
        house: { id: houses.id, name: houses.name, color: houses.color },
      })
      .from(users)
      .leftJoin(houses, eq(houses.id, users.houseId))
      .where(eq(users.major, majorCode))
      .orderBy(asc(users.name));

    return rows.map((r) => {
      const { roles, ...rest } = r;
      return {
        ...rest,
        isPresident: ((roles as string[] | null) ?? []).includes("major_president"),
      };
    });
  }

  /**
   * Same roster as getMajorMembers, but WITH medical/emergency-contact detail
   * for every student at once — a genuine bulk PII pull, used only by the
   * .xlsx export route (which is audit-logged as such). Emergency contacts
   * are redacted to relationship + phone only — the contact's own NAME is
   * stripped before it ever leaves the DB layer.
   */
  static async getMajorMembersFull(majorCode: string) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        phone: users.phone,
        contactChannels: users.contactChannels,
        noShowCount: users.noShowCount,
        roles: users.roles,
        position: users.majorPosition,
        house: { id: houses.id, name: houses.name, color: houses.color },
        chronicDiseases: users.chronicDiseases,
        medicalHistory: users.medicalHistory,
        drugAllergies: users.drugAllergies,
        foodAllergies: users.foodAllergies,
        dietaryRestrictions: users.dietaryRestrictions,
        faintingHistory: users.faintingHistory,
        emergencyMedication: users.emergencyMedication,
        hospitalNumber: users.hospitalNumber,
        hospitalName: users.hospitalName,
        emergencyContacts: users.emergencyContacts,
      })
      .from(users)
      .leftJoin(houses, eq(houses.id, users.houseId))
      .where(eq(users.major, majorCode))
      .orderBy(asc(users.name));

    return rows.map((r) => {
      const { roles, emergencyContacts, ...rest } = r;
      return {
        ...rest,
        emergencyContacts: redactEmergencyContacts(emergencyContacts),
        isPresident: ((roles as string[] | null) ?? []).includes("major_president"),
      };
    });
  }

  /**
   * Medical/emergency-contact detail for ONE student in this major — fetched
   * on demand when a president expands that student's panel (see
   * api/admin/majors/[code]/members/[memberId]/medical/route.ts), never as
   * part of the bulk roster read. Returns null if the user isn't actually in
   * this major (never trust a client-supplied memberId alone). Emergency
   * contacts are redacted to relationship + phone only, same as the roster.
   */
  static async getMajorMemberMedical(majorCode: string, userId: string) {
    const [row] = await db
      .select({
        id: users.id,
        name: users.name,
        studentId: users.studentId,
        chronicDiseases: users.chronicDiseases,
        medicalHistory: users.medicalHistory,
        drugAllergies: users.drugAllergies,
        foodAllergies: users.foodAllergies,
        dietaryRestrictions: users.dietaryRestrictions,
        faintingHistory: users.faintingHistory,
        emergencyMedication: users.emergencyMedication,
        hospitalNumber: users.hospitalNumber,
        hospitalName: users.hospitalName,
        emergencyContacts: users.emergencyContacts,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.major, majorCode)))
      .limit(1);

    if (!row) return null;
    return { ...row, emergencyContacts: redactEmergencyContacts(row.emergencyContacts) };
  }

  /**
   * Sets a major team member's `users.majorPosition` (title) — scoped by
   * majorCode so a crafted userId belonging to a different major can't be
   * touched, and scoped to this ONE column so it never collides with the
   * same user's club or SMO/ANUSMO title. Returns undefined if no user with
   * that id belongs to this major.
   *
   * A member who holds the major_president role always has position forced
   * to "president" — nobody (not even super_admin/admin through this same
   * endpoint) may set it to anything else, matching the client, which never
   * renders an editable control for that row.
   */
  static async setMemberPosition(majorCode: string, userId: string, position: string | null) {
    const [target] = await db
      .select({ id: users.id, roles: users.roles })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.major, majorCode)));
    if (!target) return undefined;

    const isPresident = ((target.roles as string[] | null) ?? []).includes("major_president");
    const effectivePosition = isPresident ? "president" : position;

    const [updated] = await db
      .update(users)
      .set({ majorPosition: effectivePosition, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.major, majorCode)))
      .returning({ id: users.id, position: users.majorPosition });
    return updated;
  }
}
