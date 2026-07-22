import { db } from "@/db";
import { attendance, events, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { AuditService } from "@/modules/audit/audit.service";
import { EventsService } from "@/modules/events/events.service";
import { normalizeFaculty } from "@/lib/faculties";

// Actor id recorded on audit rows written by this service. Deliberately not a
// real users.id (audit_logs.actorId has no FK — see AuditService) since there
// is no staff session behind these service-to-service calls. Mirrors
// songsue's own "system:activecamt-sync" convention for the opposite direction.
const SYNC_ACTOR_ID = "system:songsue-sync";

type DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SongsueEmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface SongsueCheckinSyncUser {
  email: string;
  studentId?: string | null;
  name: string;
  prefix?: string | null;
  faculty?: string | null;
  major?: string | null;
  phone?: string | null;
  nickname?: string | null;
  image?: string | null;
  religion?: string | null;
  contactChannels?: string | null;
  // Sensitive — mirrors songsue's own SyncExternalRegistrationUser doc comment:
  // written unconditionally on account creation even though ActiveCAMT's own
  // PDPA-consent-equivalent stays unset (no in-app consent has been given yet)
  // — a deliberate product decision to trust Songsue's own consent, not an
  // oversight. See the audit write below.
  chronicDiseases?: string | null;
  medicalHistory?: string | null;
  drugAllergies?: string | null;
  foodAllergies?: string | null;
  dietaryRestrictions?: string | null;
  faintingHistory?: boolean | null;
  emergencyMedication?: string | null;
  emergencyContacts?: SongsueEmergencyContact[] | null;
}

// Mirrors SENSITIVE_SYNC_FIELDS in songsue's activecamt-sync.service.ts.
const SENSITIVE_SYNC_FIELDS: (keyof SongsueCheckinSyncUser)[] = [
  "chronicDiseases", "medicalHistory", "drugAllergies", "foodAllergies",
  "dietaryRestrictions", "emergencyMedication", "faintingHistory", "emergencyContacts",
];

function isSensitiveProvided(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== "";
}

export interface SongsueCheckinSyncPayload {
  eventId: string; // ActiveCAMT's own real event id
  user: SongsueCheckinSyncUser;
  status: "attended";
}

export class SongsueSyncError extends Error {}

export class SongsueSyncService {
  /**
   * Mirrors one student's check-in fact from a Songsue-side scan onto this
   * event's "current" session (see EventsService.resolveCurrentSessionId —
   * Songsue only ever mirrors ONE session per ActiveCAMT event, so it can't
   * tell us which day; we resolve it ourselves the same way our own scanner
   * does when a caller doesn't pin one). Upserts the user by email (creating
   * a real ActiveCAMT account on first sight — profileCompleted/houseId
   * unset, but profile AND medical/emergency fields from the payload ARE
   * written; see upsertSyncedUser and SongsueCheckinSyncUser's doc comment
   * for why that's a deliberate PDPA-consent tradeoff, not an oversight).
   * Never touches houseId/points — ActiveCAMT's own house-points system is a
   * separate concern from Songsue's, and this sync only records attendance.
   * Throws SongsueSyncError if the event isn't `songsueLinked` or has no
   * sessions.
   */
  static async syncAttendedFromSongsue(payload: SongsueCheckinSyncPayload, ipAddress: string) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, payload.eventId),
      columns: { id: true, songsueLinked: true },
    });
    if (!event || !event.songsueLinked) {
      throw new SongsueSyncError("EVENT_NOT_SONGSUE_LINKED");
    }

    const sessionId = await EventsService.resolveCurrentSessionId(event.id);
    if (!sessionId) {
      throw new SongsueSyncError("EVENT_HAS_NO_SESSION");
    }

    return await db.transaction(async (tx) => {
      const { id: userId, created: createdUser, backfilledFields } = await this.upsertSyncedUser(tx, payload.user, ipAddress);

      const checkInTime = new Date();
      await tx
        .insert(attendance)
        .values({
          eventId: event.id,
          sessionId,
          studentId: userId,
          status: "attended",
          method: "songsue-sync",
          checkInTime,
        })
        .onConflictDoUpdate({
          target: [attendance.sessionId, attendance.studentId],
          set: { status: "attended", method: "songsue-sync", checkInTime },
        });

      await AuditService.logActionInternal(tx, {
        actorId: SYNC_ACTOR_ID,
        targetId: userId,
        action: `Synced from Songsue: attendance attended for event ${event.id}` +
          (createdUser
            ? " (created new ActiveCAMT account)"
            : backfilledFields.length > 0
              ? ` (backfilled incomplete profile: ${backfilledFields.join(", ")})`
              : ""),
        ipAddress,
      });

      return { userId, eventId: event.id, createdUser, backfilledFields };
    });
  }

  // Finds the user by email, or creates an account from the Songsue payload —
  // including medical/emergency fields. NO house — houses are ActiveCAMT's
  // own, unrelated concept and are never touched by this sync.
  private static async upsertSyncedUser(
    tx: DBTransaction,
    payload: SongsueCheckinSyncUser,
    ipAddress: string,
  ): Promise<{ id: string; created: boolean; backfilledFields: string[] }> {
    const existing = await tx.query.users.findFirst({
      where: eq(users.email, payload.email),
      columns: {
        id: true, profileCompleted: true, name: true, prefix: true, studentId: true,
        faculty: true, major: true, phone: true, nickname: true, image: true,
        religion: true, contactChannels: true, chronicDiseases: true, medicalHistory: true,
        drugAllergies: true, foodAllergies: true, dietaryRestrictions: true,
        faintingHistory: true, emergencyMedication: true, emergencyContacts: true,
      },
    });

    // studentId and phone are ALSO globally unique — not just email. Drop just
    // the colliding field(s) rather than fail the sync, mirroring songsue's own
    // upsertSyncedUser: the synced account still lands correctly by email.
    const studentId = payload.studentId ?? null;
    const phone = payload.phone ?? null;
    const collisions = studentId || phone
      ? await tx.query.users.findMany({
          where: sql`${studentId ? sql`${users.studentId} = ${studentId}` : sql`false`} OR ${phone ? sql`${users.phone} = ${phone}` : sql`false`}`,
          columns: { id: true, studentId: true, phone: true },
        })
      : [];
    const studentIdTaken = studentId != null && collisions.some((u) => u.studentId === studentId && u.id !== existing?.id);
    const phoneTaken = phone != null && collisions.some((u) => u.phone === phone && u.id !== existing?.id);

    if (existing) {
      if (existing.profileCompleted) return { id: existing.id, created: false, backfilledFields: [] };
      const backfilledFields = await this.backfillIncompleteProfile(tx, existing, payload, {
        studentId: studentIdTaken ? null : studentId,
        phone: phoneTaken ? null : phone,
      }, ipAddress);
      return { id: existing.id, created: false, backfilledFields };
    }

    const newId = crypto.randomUUID();
    const inserted = await tx
      .insert(users)
      .values({
        id: newId,
        email: payload.email,
        name: payload.name,
        prefix: payload.prefix ?? null,
        studentId: studentIdTaken ? null : studentId,
        faculty: normalizeFaculty(payload.faculty),
        major: payload.major ?? null,
        phone: phoneTaken ? null : phone,
        nickname: payload.nickname ?? null,
        image: payload.image ?? null,
        religion: payload.religion ?? null,
        contactChannels: payload.contactChannels ?? null,
        chronicDiseases: payload.chronicDiseases ?? null,
        medicalHistory: payload.medicalHistory ?? null,
        drugAllergies: payload.drugAllergies ?? null,
        foodAllergies: payload.foodAllergies ?? null,
        dietaryRestrictions: payload.dietaryRestrictions ?? null,
        faintingHistory: payload.faintingHistory ?? null,
        emergencyMedication: payload.emergencyMedication ?? null,
        emergencyContacts: payload.emergencyContacts ?? null,
        profileCompleted: false,
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });

    if (inserted.length > 0) {
      // PDPA change-trail (field NAMES only, never values) — mirrors songsue's
      // own audit write for the opposite sync direction.
      const provided = SENSITIVE_SYNC_FIELDS.filter((f) => isSensitiveProvided(payload[f]));
      if (provided.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: SYNC_ACTOR_ID,
          targetId: newId,
          action: `Synced from Songsue: wrote medical/emergency info without ActiveCAMT consent (${provided.join(", ")})`,
          ipAddress,
        });
      }
      return { id: inserted[0].id, created: true, backfilledFields: [] };
    }

    // Lost the insert race — re-read the row the other transaction created.
    const raced = await tx.query.users.findFirst({
      where: eq(users.email, payload.email),
      columns: { id: true },
    });
    if (!raced) throw new Error("USER_UPSERT_RACE_UNRESOLVED");
    return { id: raced.id, created: false, backfilledFields: [] };
  }

  // Fills in fields on an existing, never-completed-onboarding row — never
  // overwrites a value that's already there, EXCEPT `name` (unconditionally
  // replaced, same as songsue's own backfillIncompleteProfile — a bare
  // sign-in always has SOME name that was never actually chosen for use here).
  private static async backfillIncompleteProfile(
    tx: DBTransaction,
    existing: {
      id: string; name: string; prefix: string | null; studentId: string | null;
      faculty: string | null; major: string | null; phone: string | null;
      nickname: string | null; image: string | null; religion: string | null;
      contactChannels: string | null; chronicDiseases: string | null;
      medicalHistory: string | null; drugAllergies: string | null;
      foodAllergies: string | null; dietaryRestrictions: string | null;
      faintingHistory: boolean | null; emergencyMedication: string | null;
      emergencyContacts: unknown;
    },
    payload: SongsueCheckinSyncUser,
    resolved: { studentId: string | null; phone: string | null },
    ipAddress: string,
  ): Promise<string[]> {
    const patch: Record<string, unknown> = {};
    const patchedFields: string[] = [];
    const fill = (field: string, existingValue: unknown, next: unknown) => {
      if (existingValue == null || existingValue === "") {
        if (next != null && next !== "") {
          patch[field] = next;
          patchedFields.push(field);
        }
      }
    };

    if (payload.name) { patch.name = payload.name; patchedFields.push("name"); }

    fill("prefix", existing.prefix, payload.prefix ?? null);
    fill("studentId", existing.studentId, resolved.studentId);
    fill("faculty", existing.faculty, payload.faculty ? normalizeFaculty(payload.faculty) : null);
    fill("major", existing.major, payload.major ?? null);
    fill("phone", existing.phone, resolved.phone);
    fill("nickname", existing.nickname, payload.nickname ?? null);
    fill("image", existing.image, payload.image ?? null);
    fill("religion", existing.religion, payload.religion ?? null);
    fill("contactChannels", existing.contactChannels, payload.contactChannels ?? null);
    fill("chronicDiseases", existing.chronicDiseases, payload.chronicDiseases ?? null);
    fill("medicalHistory", existing.medicalHistory, payload.medicalHistory ?? null);
    fill("drugAllergies", existing.drugAllergies, payload.drugAllergies ?? null);
    fill("foodAllergies", existing.foodAllergies, payload.foodAllergies ?? null);
    fill("dietaryRestrictions", existing.dietaryRestrictions, payload.dietaryRestrictions ?? null);
    fill("faintingHistory", existing.faintingHistory, payload.faintingHistory ?? null);
    fill("emergencyMedication", existing.emergencyMedication, payload.emergencyMedication ?? null);
    if ((existing.emergencyContacts == null || (Array.isArray(existing.emergencyContacts) && existing.emergencyContacts.length === 0))
      && payload.emergencyContacts && payload.emergencyContacts.length > 0) {
      patch.emergencyContacts = payload.emergencyContacts;
      patchedFields.push("emergencyContacts");
    }

    if (patchedFields.length === 0) return [];

    await tx.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, existing.id));

    const sensitiveBackfilled = patchedFields.filter((f) => (SENSITIVE_SYNC_FIELDS as string[]).includes(f));
    if (sensitiveBackfilled.length > 0) {
      await AuditService.logActionInternal(tx, {
        actorId: SYNC_ACTOR_ID,
        targetId: existing.id,
        action: `Synced from Songsue: backfilled medical/emergency info without ActiveCAMT consent (${sensitiveBackfilled.join(", ")})`,
        ipAddress,
      });
    }

    return patchedFields;
  }
}
