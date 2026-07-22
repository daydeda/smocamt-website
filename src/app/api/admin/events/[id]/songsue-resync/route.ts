import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, events, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { effectiveRoles } from "@/lib/admin-access";
import { syncEventToSongsue, syncRegistrationToSongsue, type SongsueEmergencyContact } from "@/lib/songsue-sync";

export const dynamic = "force-dynamic";

// POST /api/admin/events/[id]/songsue-resync — manually re-fire the event-level
// Songsue mirror (src/lib/songsue-sync.ts). songsue-sync.ts has no retry queue in
// v1: if the original syncEventToSongsue call failed (Songsue down, network blip,
// etc.) the event silently never lands on Songsue's side, and every subsequent
// registration sync 404s with "Event has not been synced from ActiveCAMT yet"
// forever. This lets staff recover without needing a code deploy.
//
// Backfills every CURRENT attendee's registration too, not just the event
// itself — a student who registered in the window before this event existed
// on Songsue's side had their own sync 404 and silently vanish (same
// no-retry-queue gap, one level down); fixing only the event leaves their
// headcount permanently missing from Songsue with no other recovery path.
//
// super_admin/admin only — NOT the broader registration/organizer set the rest
// of this route family uses. The attendee backfill below sends full medical/
// emergency-contact detail (not just the signal) to Songsue for every attendee
// of the event; every other surface in this codebase (e.g. the attendance
// route's canViewMedical) keeps that detail admin-only, so this route follows
// the same line rather than the broader "can manage events" gate.
const SENSITIVE_FIELDS = [
  "chronicDiseases", "medicalHistory", "drugAllergies", "foodAllergies",
  "dietaryRestrictions", "faintingHistory", "emergencyMedication", "emergencyContacts",
] as const;

function hasSensitiveData(row: Record<string, unknown>): boolean {
  return SENSITIVE_FIELDS.some((field) => {
    const value = row[field];
    if (value === null || value === undefined) return false;
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== "";
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    const isAdminRole = myRoles.some((r) => ["super_admin", "admin"].includes(r));
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const event = await db.query.events.findFirst({ where: eq(events.id, id) });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (!event.songsueLinked) {
      return NextResponse.json({ error: "Event is not linked to Songsue" }, { status: 400 });
    }

    await syncEventToSongsue({
      externalId: event.id,
      title: event.title,
      description: event.description,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      location: event.location,
      pointsAwarded: event.pointsAwarded,
      individualPointsAwarded: event.individualPointsAwarded,
      walkInsEnabled: event.walkInsEnabled,
      quota: event.quota,
      quotaWalkIn: event.quotaWalkIn,
    });

    // Backfill attendees AFTER the event resync above, so the target event is
    // guaranteed to exist on Songsue's side by the time these land. A
    // multi-day (per-session) event can have several attendance rows per
    // student — collapse to one status per student, 'attended' winning over
    // 'registered', since Songsue's mirror is per-student, not per-session.
    const rows = await db
      .select({
        email: users.email,
        studentId: users.studentId,
        name: users.name,
        prefix: users.prefix,
        faculty: users.faculty,
        major: users.major,
        phone: users.phone,
        nickname: users.nickname,
        image: users.image,
        religion: users.religion,
        contactChannels: users.contactChannels,
        chronicDiseases: users.chronicDiseases,
        medicalHistory: users.medicalHistory,
        drugAllergies: users.drugAllergies,
        foodAllergies: users.foodAllergies,
        dietaryRestrictions: users.dietaryRestrictions,
        faintingHistory: users.faintingHistory,
        emergencyMedication: users.emergencyMedication,
        emergencyContacts: users.emergencyContacts,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(users, eq(attendance.studentId, users.id))
      .where(eq(attendance.eventId, event.id));

    const byEmail = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byEmail.get(row.email);
      if (!existing || (row.status === "attended" && existing.status !== "attended")) {
        byEmail.set(row.email, row);
      }
    }

    let attendeesWithSensitiveData = 0;
    for (const row of byEmail.values()) {
      const { status, ...user } = row;
      if (hasSensitiveData(row)) attendeesWithSensitiveData++;
      await syncRegistrationToSongsue({
        externalEventId: event.id,
        user: { ...user, emergencyContacts: user.emergencyContacts as SongsueEmergencyContact[] | null },
        status: (status as "registered" | "attended") ?? "registered",
      });
    }

    await db.transaction(async (tx) => {
      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: `Manually resynced Event to Songsue: ${event.title} (${byEmail.size} attendee${byEmail.size === 1 ? "" : "s"} backfilled` +
          (attendeesWithSensitiveData > 0
            ? `, including medical/emergency-contact detail for ${attendeesWithSensitiveData} of them`
            : "") +
          ")",
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true, attendeesBackfilled: byEmail.size });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
