import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { verifyQrToken, verifyCrossAppQrToken, splitCombinedQrToken } from "@/lib/qr-token";
import { fetchSongsueProfileByEmail } from "@/lib/songsue-sync";
import { SongsueSyncService } from "@/modules/integrations/songsue-sync.service";
import { getStaffBypassNickname } from "@/lib/staff-bypass";
import { HousesService, HOUSE_BALANCE_LOCK_KEY } from "@/modules/houses/houses.service";

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
}
