import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { FACULTY_IDS } from "@/lib/profile/faculties";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { HousesService, HOUSE_BALANCE_LOCK_KEY } from "@/modules/houses/houses.service";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

// Emergency contacts are stored as a jsonb array of {name, relationship, phone}.
// Validate the shape instead of accepting z.any() — the onboarding form always
// sends this structure, and a typed schema stops arbitrary/oversized JSON (a jsonb
// bloat vector) from being written straight into the row. Fields are tolerant of
// empty strings because the second contact is optional in the UI.
const emergencyContactSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
});

const profileSchema = z.object({
  name: z.string().min(1),
  nickname: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  faculty: z.enum(FACULTY_IDS as [string, ...string[]]).optional().nullable(),
  major: z.string().optional().nullable(),
  prefix: z.string().optional().nullable(),
  religion: z.string().optional().nullable(),
  contactChannels: z.string().optional().nullable(),
  chronicDiseases: z.string().optional().nullable(),
  medicalHistory: z.string().optional().nullable(),
  drugAllergies: z.string().optional().nullable(),
  foodAllergies: z.string().optional().nullable(),
  dietaryRestrictions: z.string().optional().nullable(),
  emergencyContacts: z.array(emergencyContactSchema).optional().nullable(),
  faintingHistory: z.boolean().optional().nullable(),
  emergencyMedication: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  studentId: z.string().optional().nullable(), // Allow empty or null for admins
});

// Onboarding (POST) only: the PDPA consent tick is enforced server-side, not just by
// the form, and `true` is persisted to users.pdpa_consent. PATCH keeps the base schema
// (its body doesn't carry consent, and zod strips unknown keys).
const onboardingSchema = profileSchema.extend({
  pdpaConsent: z.literal(true),
});

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

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      // The static qrToken is a long-lived check-in credential — the dashboard
      // gets short-lived signed tokens from /api/qr-token instead, so it must
      // never ride along in profile responses.
      columns: { qrToken: false },
      with: { house: true }
    });

    return NextResponse.json(user);
  } catch (error) {
    // Log a plain message only — never the raw error, whose Postgres `detail` can
    // carry PII (student id, phone) from the failing row.
    console.error("Profile GET error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST: Initial Onboarding
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const data = onboardingSchema.parse(body);

    const isAdmin =["super_admin", "admin", "registration", "organizer"].includes(session.user.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session.user.role, session.user.roles), session.user.smoPosition, session.user.anusmoPosition);
    if (!data.studentId && !isAdmin) {
      return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
    }

    // 1. Check if user already completed profile
    const existing = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (existing?.profileCompleted) {
       return NextResponse.json({ error: "Profile already completed" }, { status: 400 });
    }

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
    const updated = await db.transaction(async (tx) => {
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
        .where(and(eq(users.id, session.user!.id!), eq(users.profileCompleted, false)))
        .returning();

      if (!row) return null; // already completed by a concurrent request — skip the audit write

      // PDPA change-trail (field NAMES only): the data subject provided medical/
      // emergency info at onboarding. Same tx, so it commits atomically with the row.
      const provided = SENSITIVE_FIELDS.filter((f) => isSensitiveProvided((data as Record<string, unknown>)[f]));
      if (provided.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          targetId: session.user!.id!,
          action: `Self: provided medical/emergency info at onboarding (${provided.join(", ")})`,
          ipAddress: getClientIp(req),
        });
      }
      return row;
    });

    // 0-row update ⇒ a concurrent POST already completed onboarding. Return the same
    // "already completed" response as the pre-transaction check above.
    if (!updated) {
      return NextResponse.json({ error: "Profile already completed" }, { status: 400 });
    }

    revalidatePath("/");
    revalidatePath("/dashboard");

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { qrToken: _qrToken, ...safeUser } = updated;
    return NextResponse.json({ success: true, user: safeUser });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map(i => `${i.path}: ${i.message}`).join(", ") }, { status: 400 });
    }

    // Handle Postgres Unique Constraint Violation (duplicate entries).
    // Deliberately generic: naming the colliding field would let anyone with an
    // account enumerate which student IDs / phone numbers exist in the system.
    const dbError = error instanceof Error && error.cause ? error.cause : error;
    if (dbError && typeof dbError === "object" && "code" in dbError && dbError.code === "23505") {
      return NextResponse.json({ error: "infoAlreadyInUse" }, { status: 400 });
    }

    // Message only — the raw error's Postgres `detail` can carry PII from the row.
    console.error("Profile onboarding error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH: Regular Update
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const data = profileSchema.parse(body);

    // studentId gates Thai/International event eligibility and is set at onboarding.
    // The UI locks it, but a raw PATCH could still send a new value — strip it here
    // for non-admins so it can never be changed after the fact.
    const isAdmin = ["super_admin", "admin", "registration", "organizer"].includes(session.user.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session.user.role, session.user.roles), session.user.smoPosition, session.user.anusmoPosition);
    if (!isAdmin) {
      delete data.studentId;
      // Faculty is set once at onboarding and gates which house a student is
      // balanced into there. Lock it for non-admins so a raw PATCH can't switch
      // faculties (and retroactively make an already-picked house look wrong).
      delete data.faculty;
    }

    const updated = await db.transaction(async (tx) => {
      // Read current sensitive fields first so we can record which the data subject
      // actually CHANGED (names only). The audit write shares this tx — atomic with
      // the update, no read-without-log window.
      const before = await tx.query.users.findFirst({
        where: eq(users.id, session.user!.id!),
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
        .where(eq(users.id, session.user!.id!))
        .returning();

      const beforeRec = (before ?? {}) as Record<string, unknown>;
      const dataRec = data as Record<string, unknown>;
      const changed = SENSITIVE_FIELDS.filter(
        (f) => dataRec[f] !== undefined && sensitiveChanged(beforeRec[f], dataRec[f])
      );
      if (changed.length > 0) {
        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          targetId: session.user!.id!,
          action: `Self: updated own medical/emergency fields (${changed.join(", ")})`,
          ipAddress: getClientIp(req),
        });
      }
      return row;
    });

    revalidatePath("/");
    revalidatePath("/dashboard");

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { qrToken: _qrToken, ...safeUser } = updated;
    return NextResponse.json({ success: true, user: safeUser });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Handle Postgres Unique Constraint Violation (duplicate entries).
    // Deliberately generic: naming the colliding field would let anyone with an
    // account enumerate which student IDs / phone numbers exist in the system.
    const dbError = error instanceof Error && error.cause ? error.cause : error;
    if (dbError && typeof dbError === "object" && "code" in dbError && dbError.code === "23505") {
      return NextResponse.json({ error: "infoAlreadyInUse" }, { status: 400 });
    }

    // Message only — the raw error's Postgres `detail` can carry PII from the row.
    console.error("Profile update error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
