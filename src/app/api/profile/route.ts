import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { FACULTY_IDS } from "@/lib/profile/faculties";
import { getClientIp } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
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

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await UsersService.getOwnProfile(session.user.id);

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
    const existing = await UsersService.findUserById(session.user.id);

    if (existing?.profileCompleted) {
       return NextResponse.json({ error: "Profile already completed" }, { status: 400 });
    }

    const updated = await UsersService.completeOnboarding(session.user.id, data, getClientIp(req));

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

    const updated = await UsersService.updateOwnProfile(session.user.id, data, getClientIp(req));

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
