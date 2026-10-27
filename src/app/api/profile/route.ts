import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { FACULTY_IDS } from "@/lib/profile/faculties";
import { rateLimit } from "@/lib/util/rate-limit";
import { getClientIp } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { composeFullName, hasInvalidNameChars, contactHasName, contactNeedsLatinConfirm, validateNameParts } from "@/lib/profile/name";

// Emergency contacts are stored as a jsonb array of {name, relationship, phone}.
// Validate the shape instead of accepting z.any() — the onboarding form always
// sends this structure, and a typed schema stops arbitrary/oversized JSON (a jsonb
// bloat vector) from being written straight into the row. Fields are tolerant of
// empty strings because the second contact is optional in the UI.
const emergencyContactSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
  // Per-contact "keep English" confirmation (non-Thai contact of a Thai student).
  latinNameConfirmed: z.boolean().optional(),
  // Split name (first/last required by the form, middle + nickname optional). `name`
  // is rebuilt from the parts below so readers of `name` (exports, admin views) keep working.
  firstName: z.string().max(100).optional(),
  middleName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  nickname: z.string().max(100).optional(),
}).transform((c) => {
  const out: Record<string, unknown> = { name: c.name, relationship: c.relationship, phone: c.phone };
  if (c.firstName !== undefined || c.lastName !== undefined) {
    out.firstName = (c.firstName ?? "").trim();
    out.lastName = (c.lastName ?? "").trim();
    if (c.middleName?.trim()) out.middleName = c.middleName.trim();
    if (c.nickname?.trim()) out.nickname = c.nickname.trim();
    out.name = composeFullName({ firstName: out.firstName as string, middleName: c.middleName, lastName: out.lastName as string });
  }
  if (c.latinNameConfirmed) out.latinNameConfirmed = true;
  return out as { name: string; relationship: string; phone: string; firstName?: string; middleName?: string; lastName?: string; nickname?: string; latinNameConfirmed?: boolean };
});

const profileSchema = z.object({
  // Legacy single-field name, still accepted from older clients. New clients send
  // firstName/middleName/lastName and the server rebuilds `name` from them.
  name: z.string().optional(),
  firstName: z.string().max(100).optional(),
  middleName: z.string().max(100).optional().nullable(),
  lastName: z.string().max(100).optional(),
  latinNameConfirmed: z.boolean().optional(),
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
  // Optional HN + issuing hospital (HN has no common format and differs per hospital,
  // so no pattern check — just a length cap). Empty strings are stored as null.
  hospitalNumber: z.string().max(30).optional().nullable(),
  hospitalName: z.string().max(100).optional().nullable(),
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

/**
 * Resolve the submitted name into the columns to write. With name parts: validate
 * (first + last required; Thai script unless the student confirmed a Latin name),
 * rebuild the display `name`, and clear the review flag. Legacy `name`-only bodies
 * pass through untouched. Returns an error code string when invalid.
 */
/**
 * Normalise the optional HN pair: trim, store empty as null, and require the hospital
 * name whenever an HN is given (an HN alone identifies nothing). Returns an error code
 * or the fields to write. Absent keys are left untouched so older clients keep working.
 */
function resolveHospitalFields(data: z.infer<typeof profileSchema>): { error: string } | { fields: Record<string, unknown> } {
  if (data.hospitalNumber === undefined && data.hospitalName === undefined) return { fields: {} };
  const hospitalNumber = data.hospitalNumber?.trim() || null;
  const hospitalName = data.hospitalName?.trim() || null;
  if (hospitalNumber && !hospitalName) return { error: "hospitalNameRequired" };
  return { fields: { hospitalNumber, hospitalName: hospitalNumber ? hospitalName : null } };
}

/**
 * Same Thai-script rule as the student's own name, applied to emergency contacts: when
 * the student's name is Thai, a contact with Latin letters needs its own confirmation.
 * Only enforced when the body says whether the student's name is Latin-confirmed (new
 * clients always send it), so an older cached client is not locked out.
 */
function contactsViolateThaiRule(data: z.infer<typeof profileSchema>): boolean {
  if (data.latinNameConfirmed === undefined || !data.emergencyContacts) return false;
  return data.emergencyContacts.some((c) => contactNeedsLatinConfirm(c, data.latinNameConfirmed!));
}

/** A split contact that has any content but lacks a first or last name. */
function contactsMissingNameParts(data: z.infer<typeof profileSchema>): boolean {
  return (data.emergencyContacts ?? []).some(
    (c) => (c.firstName !== undefined || c.lastName !== undefined)
      && !!(c.name.trim() || c.relationship.trim() || c.phone.trim())
      && !contactHasName(c),
  );
}

/** Digits are not allowed in the student's nickname or any emergency-contact name part. */
function hasInvalidCharsInNames(data: z.infer<typeof profileSchema>): boolean {
  if (hasInvalidNameChars(data.nickname)) return true;
  return (data.emergencyContacts ?? []).some(
    (c) => hasInvalidNameChars(c.name) || hasInvalidNameChars(c.firstName) || hasInvalidNameChars(c.middleName) || hasInvalidNameChars(c.lastName) || hasInvalidNameChars(c.nickname),
  );
}

function resolveNameFields(data: z.infer<typeof profileSchema>): { error: string } | { fields: Record<string, unknown> } {
  const hasParts = data.firstName !== undefined || data.lastName !== undefined || data.middleName !== undefined;
  if (!hasParts) {
    if (!data.name?.trim()) return { error: "nameRequired" };
    return { fields: { name: data.name } };
  }
  const parts = {
    firstName: data.firstName?.trim(),
    middleName: data.middleName?.trim() || null,
    lastName: data.lastName?.trim(),
  };
  const confirmed = data.latinNameConfirmed ?? false;
  const err = validateNameParts(parts, confirmed);
  if (err) return { error: err };
  return {
    fields: {
      name: composeFullName(parts),
      firstName: parts.firstName,
      middleName: parts.middleName,
      lastName: parts.lastName,
      latinNameConfirmed: confirmed,
      nameNeedsReview: false,
    },
  };
}

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

    const nameFields = resolveNameFields(data);
    if ("error" in nameFields) {
      return NextResponse.json({ error: nameFields.error }, { status: 400 });
    }
    const hospitalFields = resolveHospitalFields(data);
    if ("error" in hospitalFields) {
      return NextResponse.json({ error: hospitalFields.error }, { status: 400 });
    }
    if (contactsMissingNameParts(data)) {
      return NextResponse.json({ error: "nameRequired" }, { status: 400 });
    }
    if (hasInvalidCharsInNames(data)) {
      return NextResponse.json({ error: "nameInvalidChars" }, { status: 400 });
    }
    if (contactsViolateThaiRule(data)) {
      return NextResponse.json({ error: "contactNameThaiOnly" }, { status: 400 });
    }
    const { name: _n, firstName: _f, middleName: _m, lastName: _l, latinNameConfirmed: _c, hospitalNumber: _hn, hospitalName: _hh, ...rest } = data;
    void [_n, _f, _m, _l, _c, _hn, _hh];

    const updated = await UsersService.completeOnboarding(session.user.id, { ...rest, ...nameFields.fields, ...hospitalFields.fields }, getClientIp(req));

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

    const nameFields = resolveNameFields(data);
    if ("error" in nameFields) {
      return NextResponse.json({ error: nameFields.error }, { status: 400 });
    }
    const hospitalFields = resolveHospitalFields(data);
    if ("error" in hospitalFields) {
      return NextResponse.json({ error: hospitalFields.error }, { status: 400 });
    }
    if (contactsMissingNameParts(data)) {
      return NextResponse.json({ error: "nameRequired" }, { status: 400 });
    }
    if (hasInvalidCharsInNames(data)) {
      return NextResponse.json({ error: "nameInvalidChars" }, { status: 400 });
    }
    if (contactsViolateThaiRule(data)) {
      return NextResponse.json({ error: "contactNameThaiOnly" }, { status: 400 });
    }
    const { name: _n, firstName: _f, middleName: _m, lastName: _l, latinNameConfirmed: _c, hospitalNumber: _hn, hospitalName: _hh, ...rest } = data;
    void [_n, _f, _m, _l, _c, _hn, _hh];

    // The phone is editable after onboarding, so tell the user when the number
    // belongs to someone else (the unique index stays the race-proof backstop).
    // This confirms a number exists in the system, so the lookup is rate limited.
    if (data.phone?.trim()) {
      const phoneLimit = await rateLimit(`profile-phone:${session.user.id}`, 10, 60_000);
      if (!phoneLimit.success) {
        return NextResponse.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429 });
      }
      if (await UsersService.isPhoneTakenByOther(data.phone.trim(), session.user.id)) {
        return NextResponse.json({ error: "phoneAlreadyRegistered" }, { status: 400 });
      }
    }

    const updated = await UsersService.updateOwnProfile(session.user.id, { ...rest, ...nameFields.fields, ...hospitalFields.fields }, getClientIp(req));

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
