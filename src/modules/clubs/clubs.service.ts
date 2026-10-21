import { db } from "@/db";
import { clubs, clubMembers, events, houses, users } from "@/db/schema";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { redactEmergencyContacts } from "@/lib/pdpa/emergency-contacts";

// Mirrors AuditService's DBTransaction type (src/modules/audit/audit.service.ts) so
// callers that need setUserClubPresidencies to be atomic with their own writes (e.g.
// the users PATCH route's audit log) can pass their existing `tx` through instead of
// letting this open its own separate transaction.
type DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ClubsService {
  /**
   * Lists clubs (optionally including archived ones), each annotated with its
   * total member count and president count via a single grouped aggregate —
   * avoids an N+1 count-per-club query.
   */
  static async listClubs(includeArchived: boolean) {
    const rows = await db
      .select({
        id: clubs.id,
        name: clubs.name,
        isArchived: clubs.isArchived,
        createdAt: clubs.createdAt,
        memberCount: sql<number>`count(${clubMembers.id})::int`,
        presidentCount: sql<number>`count(${clubMembers.id}) filter (where ${clubMembers.role} = 'president')::int`,
      })
      .from(clubs)
      .leftJoin(clubMembers, eq(clubMembers.clubId, clubs.id))
      .where(includeArchived ? undefined : eq(clubs.isArchived, false))
      .groupBy(clubs.id)
      .orderBy(asc(clubs.name));

    return rows;
  }

  /**
   * Creates a new club. isArchived defaults false (schema default).
   */
  static async createClub(name: string) {
    const [created] = await db.insert(clubs).values({ name }).returning();
    return created;
  }

  /**
   * Renames a club.
   */
  static async renameClub(id: string, name: string) {
    const [updated] = await db
      .update(clubs)
      .set({ name, updatedAt: new Date() })
      .where(eq(clubs.id, id))
      .returning();
    return updated;
  }

  /**
   * Archives or unarchives a club. Clubs are never hard-deleted so events they
   * already own and their membership history survive.
   */
  static async setArchived(id: string, isArchived: boolean) {
    const [updated] = await db
      .update(clubs)
      .set({ isArchived, updatedAt: new Date() })
      .where(eq(clubs.id, id))
      .returning();
    return updated;
  }

  /**
   * Permanently deletes a club. club_members rows cascade automatically (FK
   * ON DELETE CASCADE), but events.ownerClubIds is a jsonb array with no FK —
   * Postgres can't cascade into it, so any event still listing this club as an
   * owner is patched to drop the id first. Otherwise a deleted club's id would
   * silently linger in an event's ownerClubIds, which is harmless for scoping
   * (it just never matches anyone) but confusing to a future reader/audit.
   * Returns the deleted club row, or undefined if no club had that id.
   */
  static async deleteClub(id: string) {
    return await db.transaction(async (tx) => {
      const affected = await tx
        .select({ id: events.id, ownerClubIds: events.ownerClubIds })
        .from(events)
        .where(sql`${events.ownerClubIds} @> ${JSON.stringify([id])}::jsonb`);

      for (const ev of affected) {
        const next = (ev.ownerClubIds ?? []).filter((clubId) => clubId !== id);
        await tx
          .update(events)
          .set({ ownerClubIds: next.length > 0 ? next : null })
          .where(eq(events.id, ev.id));
      }

      const [deleted] = await tx.delete(clubs).where(eq(clubs.id, id)).returning();
      return deleted;
    });
  }

  /**
   * Lists a club's members with role, joined with the user's roster detail —
   * a club_president manages their own club/events with this (see
   * admin/clubs/page.tsx), so beyond identity (name/studentId) it also
   * includes contact info, major, and house. Medical detail/emergency
   * contacts are deliberately NOT included here (data minimization) — they're
   * fetched per-member, on demand, via getClubMemberMedical, only when a
   * president actually expands that one member's panel, so the audit trail
   * (and the data that leaves the server at all) reflects who was actually
   * looked at rather than the whole roster on every page load. Use
   * getClubMembersFull for a genuine bulk pull (the .xlsx export, which
   * legitimately needs everyone's detail at once).
   */
  static async getClubMembers(clubId: string) {
    const rows = await db
      .select({
        id: clubMembers.id,
        userId: clubMembers.userId,
        role: clubMembers.role,
        userName: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        major: users.major,
        phone: users.phone,
        contactChannels: users.contactChannels,
        noShowCount: users.noShowCount,
        house: { id: houses.id, name: houses.name, color: houses.color },
        // Per-club staff title (src/lib/positions.ts) — distinct from `role`
        // above, which is just this club_members row's 'member'/'president'.
        // Always "president" when role === 'president' (kept in sync by
        // setMemberPosition/applyClubPresidencies below — see the "locked
        // position" comment there) — never independently editable. Scoped to
        // THIS club_members row, so the same user can hold a different title
        // in another club (or major/SMO/ANUSMO) without collision.
        position: clubMembers.position,
      })
      .from(clubMembers)
      .innerJoin(users, eq(users.id, clubMembers.userId))
      .leftJoin(houses, eq(houses.id, users.houseId))
      .where(eq(clubMembers.clubId, clubId))
      .orderBy(asc(users.name));

    return rows;
  }

  /**
   * Same roster as getClubMembers, but WITHOUT phone/contactChannels — for a
   * non-president staff-position holder's (e.g. secretary, finance — any
   * NON_SMO_POSITION_IDS title short of "president") read-only view of their
   * own club (see GET .../members' staff-position tier). No medical/
   * emergency-contact access exists at this tier at all — that stays a
   * separate on-demand route gated to admin/club_president only.
   */
  static async getClubMembersLimited(clubId: string) {
    const rows = await db
      .select({
        id: clubMembers.id,
        userId: clubMembers.userId,
        role: clubMembers.role,
        userName: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        major: users.major,
        house: { id: houses.id, name: houses.name, color: houses.color },
        position: clubMembers.position,
      })
      .from(clubMembers)
      .innerJoin(users, eq(users.id, clubMembers.userId))
      .leftJoin(houses, eq(houses.id, users.houseId))
      .where(eq(clubMembers.clubId, clubId))
      .orderBy(asc(users.name));

    return rows;
  }

  /**
   * Same roster as getClubMembers, but WITH medical/emergency-contact detail
   * for every member at once — a genuine bulk PII pull, used only by the
   * .xlsx export route (which is audit-logged as such). Emergency contacts
   * are redacted to relationship + phone only — the contact's own NAME is
   * stripped before it ever leaves the DB layer, never sent to a president.
   */
  static async getClubMembersFull(clubId: string) {
    const rows = await db
      .select({
        id: clubMembers.id,
        userId: clubMembers.userId,
        role: clubMembers.role,
        userName: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        major: users.major,
        phone: users.phone,
        contactChannels: users.contactChannels,
        noShowCount: users.noShowCount,
        house: { id: houses.id, name: houses.name, color: houses.color },
        chronicDiseases: users.chronicDiseases,
        medicalHistory: users.medicalHistory,
        drugAllergies: users.drugAllergies,
        foodAllergies: users.foodAllergies,
        dietaryRestrictions: users.dietaryRestrictions,
        faintingHistory: users.faintingHistory,
        emergencyMedication: users.emergencyMedication,
        emergencyContacts: users.emergencyContacts,
        position: clubMembers.position,
      })
      .from(clubMembers)
      .innerJoin(users, eq(users.id, clubMembers.userId))
      .leftJoin(houses, eq(houses.id, users.houseId))
      .where(eq(clubMembers.clubId, clubId))
      .orderBy(asc(users.name));

    return rows.map((r) => ({
      ...r,
      emergencyContacts: redactEmergencyContacts(r.emergencyContacts),
    }));
  }

  /**
   * Medical/emergency-contact detail for ONE member of this club — fetched
   * on demand when a president expands that member's panel (see
   * api/admin/clubs/[id]/members/[memberId]/medical/route.ts), never as part
   * of the bulk roster read. Returns null if the user isn't actually a member
   * of this club (never trust a client-supplied memberId alone). Emergency
   * contacts are redacted to relationship + phone only, same as the roster.
   */
  static async getClubMemberMedical(clubId: string, userId: string) {
    const [row] = await db
      .select({
        userId: clubMembers.userId,
        userName: users.name,
        studentId: users.studentId,
        chronicDiseases: users.chronicDiseases,
        medicalHistory: users.medicalHistory,
        drugAllergies: users.drugAllergies,
        foodAllergies: users.foodAllergies,
        dietaryRestrictions: users.dietaryRestrictions,
        faintingHistory: users.faintingHistory,
        emergencyMedication: users.emergencyMedication,
        emergencyContacts: users.emergencyContacts,
      })
      .from(clubMembers)
      .innerJoin(users, eq(users.id, clubMembers.userId))
      .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)))
      .limit(1);

    if (!row) return null;
    return { ...row, emergencyContacts: redactEmergencyContacts(row.emergencyContacts) };
  }

  /**
   * Adds a user to a club as a plain 'member' — the rank-and-file counterpart to
   * the 'president' role. Idempotent: re-adding someone who's already a member
   * OR already a president is a no-op (never downgrades an existing president —
   * that role is only ever granted/revoked via setUserClubPresidencies, which
   * stays in sync with the user's club_president system role tag; this method
   * intentionally has no way to set role='president', to avoid creating a
   * club_members row that claims presidency without the matching system role).
   */
  static async addClubMember(clubId: string, userId: string) {
    const [inserted] = await db
      .insert(clubMembers)
      .values({ clubId, userId, role: "member" })
      .onConflictDoNothing({ target: [clubMembers.clubId, clubMembers.userId] })
      .returning();
    if (inserted) return inserted;

    const [existing] = await db
      .select()
      .from(clubMembers)
      .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)));
    return existing;
  }

  /**
   * Upserts a 'president' club_members row for (clubId, userId). Idempotent —
   * re-adding an existing president is a no-op besides confirming the role.
   */
  static async addClubPresident(clubId: string, userId: string) {
    const [row] = await db
      .insert(clubMembers)
      .values({ clubId, userId, role: "president" })
      .onConflictDoUpdate({
        target: [clubMembers.clubId, clubMembers.userId],
        set: { role: "president" },
      })
      .returning();
    return row;
  }

  /**
   * Club IDs this user currently presides over (role='president'). Used to
   * pre-check the club picker when a staff member opens a user's role editor.
   */
  static async getPresidentClubIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ clubId: clubMembers.clubId })
      .from(clubMembers)
      .where(and(eq(clubMembers.userId, userId), eq(clubMembers.role, "president")));
    return rows.map((r) => r.clubId);
  }

  /**
   * Club IDs this user currently belongs to, ANY role (member or president).
   * Used for event registration/visibility eligibility (events.allowedClubs) —
   * unlike getPresidentClubIds, a plain member counts here too.
   */
  static async getMemberClubIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ clubId: clubMembers.clubId })
      .from(clubMembers)
      .where(eq(clubMembers.userId, userId));
    return rows.map((r) => r.clubId);
  }

  /**
   * Club IDs where this user is a plain 'member' (never 'president') — used
   * to scope a non-president staff-position holder (e.g. secretary, finance)
   * to a read-only view of their own club(s). Naturally excludes clubs they
   * preside over — those already get the fuller club_president view via
   * getPresidentClubIds, so a president is never double-counted here.
   */
  static async getStaffMemberClubIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ clubId: clubMembers.clubId })
      .from(clubMembers)
      .where(and(eq(clubMembers.userId, userId), eq(clubMembers.role, "member")));
    return rows.map((r) => r.clubId);
  }

  /**
   * Sets a club member's `club_members.position` (title), scoped to THIS one
   * club — verifies the user is actually a member of this club before
   * writing, so a crafted userId belonging to a different club can't be
   * touched, and so the same user's title in another club (or their major/
   * SMO/ANUSMO title) is never touched. Returns undefined if the user isn't
   * a member of this club.
   *
   * A club_members row with role === 'president' always has position forced
   * to "president" — nobody (not even super_admin/admin through this same
   * endpoint) may set it to anything else, matching the client, which never
   * renders an editable control for a president row. This mirrors
   * applyClubPresidencies below, which is what puts a user into this state in
   * the first place.
   */
  static async setMemberPosition(clubId: string, userId: string, position: string | null) {
    const [membership] = await db
      .select()
      .from(clubMembers)
      .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)));
    if (!membership) return undefined;

    const effectivePosition = membership.role === "president" ? "president" : position;

    const [updated] = await db
      .update(clubMembers)
      .set({ position: effectivePosition })
      .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)))
      .returning({ id: clubMembers.id, userId: clubMembers.userId, position: clubMembers.position });
    return updated;
  }

  /**
   * Removes a (clubId, userId) membership row entirely, regardless of role.
   */
  static async removeClubMember(clubId: string, userId: string) {
    await db
      .delete(clubMembers)
      .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)));
  }

  /**
   * Given a user and the FULL desired list of clubs they should preside over,
   * diffs against their current role='president' rows and upserts/deletes to
   * match exactly. Never touches role='member' rows for this user (reserved
   * for a future roster feature).
   *
   * Accepts an optional caller-supplied `tx` so this can run INSIDE an already-
   * open transaction (e.g. the users PATCH route's own db.transaction, whose
   * audit log entry describes this exact change) — without it, a crash between
   * the two writes would leave a committed audit entry claiming a presidency
   * change that never actually landed. When no `tx` is given, opens its own
   * transaction so a direct caller still gets atomicity.
   */
  static async setUserClubPresidencies(userId: string, clubIds: string[], tx?: DBTransaction) {
    if (tx) {
      await ClubsService.applyClubPresidencies(tx, userId, clubIds);
      return;
    }
    await db.transaction(async (innerTx) => {
      await ClubsService.applyClubPresidencies(innerTx, userId, clubIds);
    });
  }

  private static async applyClubPresidencies(tx: DBTransaction, userId: string, clubIds: string[]) {
    const current = await tx
      .select({ clubId: clubMembers.clubId })
      .from(clubMembers)
      .where(and(eq(clubMembers.userId, userId), eq(clubMembers.role, "president")));

    const currentIds = new Set(current.map((c) => c.clubId));
    const desiredIds = new Set(clubIds);

    const toAdd = clubIds.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

    // Each president row carries its OWN "president" title directly (see
    // setMemberPosition's matching lock) — scoped to that one club_members
    // row, so this never touches the user's title in another club or their
    // major/SMO/ANUSMO title. Losing a presidency deletes the row outright
    // (below), so there's nothing to "release back to unset" the way the old
    // single global users.position column needed.
    for (const clubId of toAdd) {
      await tx
        .insert(clubMembers)
        .values({ clubId, userId, role: "president", position: "president" })
        .onConflictDoUpdate({
          target: [clubMembers.clubId, clubMembers.userId],
          set: { role: "president", position: "president" },
        });
    }

    if (toRemove.length > 0) {
      await tx
        .delete(clubMembers)
        .where(
          and(
            eq(clubMembers.userId, userId),
            eq(clubMembers.role, "president"),
            inArray(clubMembers.clubId, toRemove),
          ),
        );
    }
  }

  /** A club's name only ({ name } or undefined if no such club), for audit text and exports. */
  static async getClubName(clubId: string) {
    return db.query.clubs.findFirst({ where: eq(clubs.id, clubId), columns: { name: true } });
  }

  /**
   * Account search for the "add member" picker: any role, matching name or
   * studentId, capped at 10 and returning only id/name/studentId.
   */
  static async searchAccountsForMembership(q: string) {
    // No role filter — matching strictly on role="student" used to hide
    // anyone whose PRIMARY role resolved to something else (e.g. an smo, or a
    // club_president of a different club), even though they were a
    // legitimate add. This now matches any account by name/studentId.
    return db
      .select({ id: users.id, name: users.name, studentId: users.studentId })
      .from(users)
      .where(or(ilike(users.name, `%${q}%`), ilike(users.studentId, `%${q}%`)))
      .limit(10);
  }
}
