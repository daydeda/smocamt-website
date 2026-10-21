import { db } from "@/db";
import { attendance, users } from "@/db/schema";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { and, count, eq, or, sql } from "drizzle-orm";
import { verifyQrToken, verifyCrossAppQrToken, splitCombinedQrToken } from "@/lib/qr/qr-token";
import { fetchSongsueProfileByEmail } from "@/lib/integrations/songsue-sync";
import { SongsueSyncService } from "@/modules/integrations/songsue-sync.service";
import { getStaffBypassNickname } from "@/lib/access/staff-bypass";
import { HousesService, HOUSE_BALANCE_LOCK_KEY } from "@/modules/houses/houses.service";
import { AuditService } from "@/modules/audit/audit.service";

// Sensitive medical/emergency fields. Self-edits to these are recorded (field NAMES
// only, never values) as a PDPA change-trail — the actor here is the data subject.
const SENSITIVE_FIELDS = [
  "chronicDiseases", "medicalHistory", "drugAllergies", "foodAllergies",
  "dietaryRestrictions", "emergencyMedication", "faintingHistory", "emergencyContacts",
] as const;

// Normalize a sensitive value for presence/change comparison: null/undefined and a
// bare "-" both count as empty; arrays (emergency contacts) compare by JSON.
function normSensitive(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return JSON.stringify(v);
  const s = String(v).trim();
  return s === "-" ? "" : s;
}
const isSensitiveProvided = (v: unknown) => normSensitive(v) !== "";
const sensitiveChanged = (a: unknown, b: unknown) => normSensitive(a) !== normSensitive(b);

export type ProfileFieldsInput = Partial<typeof users.$inferInsert>;

export class UsersService {
  /**
   * Resolves a student profile from a QR scan token.
   * Accepts HMAC-signed 5-minute tokens (from the Digital ID page) or legacy
   * static qrToken / user ID (used for manual check-in fallback). A token
   * scanned by the "wrong" app (student generated it on Songsue, but is being
   * scanned here on ActiveCAMT) falls through to its cross-app companion (see
   * qr-token.ts's splitCombinedQrToken/verifyCrossAppQrToken), resolving by
   * email — auto-creating a minimal local account on first sight via the same
   * upsert Songsue→ActiveCAMT sync already uses, if ActiveCAMT has never seen
   * this student before. `ipAddress` is only used on that (rare, one-time per
   * student) creation path, for its PDPA audit log entry.
   */
  static async resolveStudentByToken(token: string, ipAddress: string) {
    const { local, cross } = splitCombinedQrToken(token);

    const userId = verifyQrToken(local);
    if (userId) {
      const found = await db.query.users.findFirst({
        where: eq(users.id, userId),
        with: { house: true },
      });
      if (found) return found;
    }

    if (cross) {
      const email = verifyCrossAppQrToken(cross);
      if (email) {
        const found = await db.query.users.findFirst({
          where: eq(users.email, email),
          with: { house: true },
        });
        if (found) return found;

        const profile = await fetchSongsueProfileByEmail(email);
        if (profile) {
          const { id } = await db.transaction((tx) =>
            SongsueSyncService.upsertSyncedUser(tx, profile, ipAddress)
          );
          return db.query.users.findFirst({
            where: eq(users.id, id),
            with: { house: true },
          });
        }
      }
    }

    // Legacy: static qrToken UUID or direct user ID (manual search → confirm flow)
    return db.query.users.findFirst({
      where: or(eq(users.qrToken, token), eq(users.id, token)),
      with: { house: true },
    });
  }

  /**
   * Validates if a user has admin permissions
   */
  static async isAdmin(userId: string): Promise<boolean> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        role: true,
      },
    });
    return user?.role === "admin";
  }

  /**
   * General lookup of a user by ID
   */
  static async getUserById(userId: string) {
    return await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
  }

  /**
   * Auto-provisions a staff account listed in the onboarding bypass list so it
   * never has to fill in the student onboarding form. Sets ONLY a nickname (no
   * studentId/major/medical/PDPA data), the `staff` role, and a balanced house —
   * then flips profileCompleted so proxy + onboarding stop redirecting them.
   *
   * Idempotent and race-safe: the update only fires while profileCompleted is
   * still false (a WHERE guard), so concurrent first-visits can't double-assign a
   * house or stomp data. Returns true when this call performed the provisioning,
   * false if the email isn't on the list or the account was already provisioned.
   */
  static async provisionStaffBypass(userId: string, email: string | null | undefined): Promise<boolean> {
    const nickname = getStaffBypassNickname(email);
    if (!nickname) return false;

    // Balance staff among houses by STAFF count only (students are ignored), so
    // staff spread evenly regardless of the much larger student population. Pick +
    // update run ATOMICALLY under the SAME advisory lock the student onboarding
    // uses, so concurrent first-visits (staff or students) can't both read the same
    // least-full house and pile into it. The count runs in this tx too
    // (pickBalancedHouseIdForStaff(tx)), so it's serialized, not just the write.
    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${HOUSE_BALANCE_LOCK_KEY})`);
      const houseId = await HousesService.pickBalancedHouseIdForStaff("CAMT", tx);

      return tx
        .update(users)
        .set({
          // Initial state only: seed both name and nickname so they display as the
          // nickname out of the box, carrying no real name / student profile. This
          // is NOT permanent — a staff user can later open the dashboard profile
          // editor (PATCH /api/profile) and fill in a real name/major/etc., after
          // which they look like any filled-in profile. Their role stays `staff`
          // and their house stays put regardless: PATCH and the onboarding POST
          // never write role or houseId, so only an admin can change those.
          name: nickname,
          nickname,
          role: "staff",
          roles: ["staff"],
          faculty: "CAMT",
          houseId,
          profileCompleted: true,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, userId), eq(users.profileCompleted, false)))
        .returning({ id: users.id });
    });

    return updated.length > 0;
  }

  /** Total number of user rows (public landing-page counter). */
  static async countUsers() {
    const [{ count: countVal }] = await db.select({ count: count() }).from(users);
    return countVal;
  }

  /** A user's major only (calendar visibility filtering). */
  static async getMajorById(userId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { major: true },
    });
  }

  /**
   * A shop buyer's major plus their CURRENT roles from the DB (not the session
   * token, which can lag a role change). The roles decide SMO welfare pricing,
   * which changes what the buyer is charged.
   */
  static async getShopBuyerProfile(userId: string) {
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { major: true, role: true, roles: true },
    });
    if (!row) return undefined;
    const roles = row.roles?.length ? row.roles : row.role ? [row.role] : [];
    return { major: row.major, roles };
  }

  /**
   * Bulk student directory with PDPA-minimal columns. Contact info
   * (email/phone/contactChannels) is only included when `includeContact` is set
   * (super_admin only, decided by the caller).
   */
  static async listStudentDirectory(includeContact: boolean) {
    // Only fetch non-sensitive data for the general directory
    return db.query.users.findMany({
      columns: {
        id: true,
        studentId: true,
        name: true,
        prefix: true,
        nickname: true,
        major: true,
        smoPosition: true,
        anusmoPosition: true,
        houseId: true,
        profileCompleted: true,
        role: true,
        roles: true,
        noShowCount: true,
        registrationBlocked: true,
        ...(includeContact ? { email: true, phone: true, contactChannels: true } : {}),
      },
      with: { house: true },
    });
  }

  /**
   * One student's full record (sensitive medical/emergency fields included).
   * The PDPA access audit log is written BEFORE the read, as part of the same
   * operation — FE-12: Log the sensitive data access (Immutable Audit Trail).
   */
  static async getStudentSensitiveDetail(targetStudentId: string, actorId: string, ipAddress: string) {
    // FE-12: Log the sensitive data access (Immutable Audit Trail)
    await AuditService.logAction({
      actorId,
      targetId: targetStudentId,
      action: "Viewed Sensitive Medical/Emergency Info",
      ipAddress,
    });

    return db.query.users.findFirst({
      where: eq(users.id, targetStudentId),
      // qrToken is a permanent check-in credential replayable at /api/admin/scan,
      // so it must never leave the server — every other route strips it too.
      columns: { qrToken: false },
      with: { house: true },
    });
  }

  /** A student's current strike state (for the strike-reset pre-check). */
  static async getStrikeState(targetStudentId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, targetStudentId),
      columns: { id: true, noShowCount: true, registrationBlocked: true },
    });
  }

  /** Clears a student's no-show strikes and unblocks pre-registration, with its audit log, in one transaction. */
  static async resetStrikes(
    targetStudentId: string,
    target: { noShowCount: number; registrationBlocked: boolean },
    actorId: string,
    ipAddress: string,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ noShowCount: 0, registrationBlocked: false })
        .where(eq(users.id, targetStudentId));

      await AuditService.logActionInternal(tx, {
        actorId,
        targetId: targetStudentId,
        action: `Reset no-show strikes (was ${target.noShowCount}/3${target.registrationBlocked ? ", blocked" : ""})`,
        ipAddress,
      });
    });
  }

  /** Full user row by id (admin user edit/delete pre-checks). */
  static async findUserById(userId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, userId),
    });
  }

  /**
   * Admin user update: the users row, the club presidency sync (when clubIds is
   * given) and the audit entry (when something changed) in ONE transaction, so
   * a failure can't leave a committed audit entry describing a presidency
   * change that never actually landed.
   */
  static async updateUserByAdmin(params: {
    userId: string;
    targetUserName: string | null;
    fields: Partial<typeof users.$inferInsert>;
    clubIds: string[] | undefined;
    changes: string[];
    actorId: string;
    ipAddress: string;
  }) {
    const { userId, targetUserName, fields, clubIds, changes, actorId, ipAddress } = params;
    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({
          ...fields,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      if (clubIds !== undefined) {
        await ClubsService.setUserClubPresidencies(userId, clubIds, tx);
      }

      if (changes.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId,
          targetId: userId,
          action: `Updated user ${targetUserName}: ${changes.join(", ")}`,
          ipAddress,
        });
      }
    });
  }

  /**
   * Admin account deletion. Some foreign keys referencing users.id lack ON
   * DELETE CASCADE in the production schema (attendance.student_id / scanned_by).
   * Clean those up in a transaction first, otherwise Postgres rejects the delete
   * with a FK violation. accounts / sessions / authenticators / form_submissions
   * already cascade. audit_logs rows are NEVER rewritten — their actor_id /
   * target_id values are baked into the tamper-evident row hashes, so the
   * FK constraints on audit_logs were dropped instead (migration step 27).
   */
  static async deleteUserByAdmin(
    userId: string,
    targetUser: { name: string | null; studentId: string | null },
    actorId: string,
    ipAddress: string,
  ) {
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
        actorId,
        targetId: userId,
        action: `Deleted user account: ${targetUser.name}${targetUser.studentId ? ` (${targetUser.studentId})` : ""}`,
        ipAddress,
      });
    });
  }

  /** The signed-in user's own profile row with house (no qrToken — it is a long-lived check-in credential). */
  static async getOwnProfile(userId: string) {
    return db.query.users.findFirst({
      where: eq(users.id, userId),
      // The static qrToken is a long-lived check-in credential — the dashboard
      // gets short-lived signed tokens from /api/qr-token instead, so it must
      // never ride along in profile responses.
      columns: { qrToken: false },
      with: { house: true }
    });
  }

  /**
   * Initial onboarding write. Returns the updated row, or null if a concurrent
   * request already completed onboarding (the caller maps that to "already
   * completed").
   */
  static async completeOnboarding(userId: string, data: ProfileFieldsInput, ipAddress: string) {
    // 2. Update User in a transaction so the guard + PDPA audit write + house
    // assignment all commit atomically. House is assigned HERE, at onboarding
    // completion: the least-populated colour house within the student's chosen
    // faculty, picked under the same advisory lock (HOUSE_BALANCE_LOCK_KEY) the
    // staff-bypass provisioning uses (UsersService.provisionStaffBypass), so two
    // students onboarding at once can't both read "house X has fewest" and pile
    // into it. COALESCE in the SET below preserves any houseId an admin may have
    // already set manually before onboarding completed. ScannerService.
    // ensureHouseAssigned remains as a fallback safety net for any pre-existing
    // student who onboarded before this and still has no house.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${HOUSE_BALANCE_LOCK_KEY})`);
      const faculty = data.faculty ?? "CAMT";
      const pickedHouseId = await HousesService.pickBalancedHouseIdForFaculty(faculty, tx);

      const [row] = await tx
        .update(users)
        .set({
          ...data,
          faculty,
          houseId: sql`COALESCE(${users.houseId}, ${pickedHouseId})`,
          profileCompleted: true,
          profileReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        // Guard on profileCompleted=false (mirrors provisionStaffBypass) so a
        // concurrent same-user POST that slipped past the pre-tx check updates 0
        // rows here — preventing a duplicate onboarding/PDPA audit row. 0 rows ⇒
        // already completed (handled below).
        .where(and(eq(users.id, userId), eq(users.profileCompleted, false)))
        .returning();

      if (!row) return null; // already completed by a concurrent request — skip the audit write

      // PDPA change-trail (field NAMES only): the data subject provided medical/
      // emergency info at onboarding. Same tx, so it commits atomically with the row.
      const provided = SENSITIVE_FIELDS.filter((f) => isSensitiveProvided((data as Record<string, unknown>)[f]));
      if (provided.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: userId,
          targetId: userId,
          action: `Self: provided medical/emergency info at onboarding (${provided.join(", ")})`,
          ipAddress,
        });
      }
      return row;
    });
  }

  /** Regular self profile update (medical-field changes are audit-logged in the same transaction). */
  static async updateOwnProfile(userId: string, data: ProfileFieldsInput, ipAddress: string) {
    return db.transaction(async (tx) => {
      // Read current sensitive fields first so we can record which the data subject
      // actually CHANGED (names only). The audit write shares this tx — atomic with
      // the update, no read-without-log window.
      const before = await tx.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          chronicDiseases: true, medicalHistory: true, drugAllergies: true,
          foodAllergies: true, dietaryRestrictions: true, emergencyMedication: true,
          faintingHistory: true, emergencyContacts: true,
        },
      });

      const [row] = await tx
        .update(users)
        .set({
          ...data,
          // Saving the form counts as the periodic re-confirmation.
          profileReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      const beforeRec = (before ?? {}) as Record<string, unknown>;
      const dataRec = data as Record<string, unknown>;
      const changed = SENSITIVE_FIELDS.filter(
        (f) => dataRec[f] !== undefined && sensitiveChanged(beforeRec[f], dataRec[f])
      );
      if (changed.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: userId,
          targetId: userId,
          action: `Self: updated own medical/emergency fields (${changed.join(", ")})`,
          ipAddress,
        });
      }
      return row;
    });
  }

  /**
   * Stamps profileReviewedAt for a completed profile ("my info is unchanged")
   * and writes the audit entry in one transaction. Returns false if the
   * profile isn't completed.
   */
  static async stampProfileReviewed(userId: string, reviewedAt: Date, ipAddress: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ profileReviewedAt: reviewedAt })
        .where(and(eq(users.id, userId), eq(users.profileCompleted, true)))
        .returning({ id: users.id });
      if (!row) return false;
      await AuditService.logActionInternal(tx, {
        actorId: userId,
        targetId: userId,
        action: "Self: confirmed profile info unchanged (periodic review)",
        ipAddress,
      });
      return true;
    });
  }
}
