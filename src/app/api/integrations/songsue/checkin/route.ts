import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedSongsueSync } from "@/lib/integration-auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { SongsueSyncService, SongsueSyncError } from "@/modules/integrations/songsue-sync.service";

export const dynamic = "force-dynamic";

// Mirrors emergencyContactSchema in songsue's api/profile/route.ts.
const emergencyContactSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
});

const checkinSyncSchema = z.object({
  eventId: z.string().uuid(),
  user: z.object({
    // Lowercased to match auth.ts's normalization — a mismatched case would
    // miss the existing row on email lookup and create a duplicate/phantom
    // account instead of syncing onto the real one.
    email: z.string().email().transform((e) => e.toLowerCase()),
    studentId: z.string().optional().nullable(),
    name: z.string().min(1),
    prefix: z.string().optional().nullable(),
    faculty: z.string().optional().nullable(),
    major: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    nickname: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    religion: z.string().optional().nullable(),
    contactChannels: z.string().optional().nullable(),
    // Sensitive — only written on first-time account creation, and only ever
    // sourced from Songsue's own consent, not ActiveCAMT's (see
    // SongsueCheckinSyncUser's doc comment in songsue-sync.service.ts).
    chronicDiseases: z.string().optional().nullable(),
    medicalHistory: z.string().optional().nullable(),
    drugAllergies: z.string().optional().nullable(),
    foodAllergies: z.string().optional().nullable(),
    dietaryRestrictions: z.string().optional().nullable(),
    faintingHistory: z.boolean().optional().nullable(),
    emergencyMedication: z.string().optional().nullable(),
    emergencyContacts: z.array(emergencyContactSchema).optional().nullable(),
  }),
  status: z.literal("attended"),
});

// POST /api/integrations/songsue/checkin — Songsue calls this after a student
// is checked in (QR scan or walk-in) via Songsue's OWN scanner for an event
// mirrored from ActiveCAMT (songsueLinked). Upserts the student's ActiveCAMT
// account by email (profileCompleted stays unset, but profile AND medical/
// emergency fields from the payload ARE written on first-time creation — a
// deliberate PDPA-consent tradeoff, see SongsueCheckinSyncUser's doc comment
// in songsue-sync.service.ts) and marks them attended on this event's
// "current" session — see SongsueSyncService.syncAttendedFromSongsue. 404s if
// the event isn't songsueLinked (guards a stale/tampered id or a since-
// unlinked event); 409s if the event has no sessions configured.
export async function POST(req: Request) {
  if (!isAuthorizedSongsueSync(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Defense-in-depth beyond the shared secret — mirrors songsue's own
  // register-sync route: a single check-in on the Songsue side can fire in
  // quick succession per student during a live event.
  const ip = getClientIp(req);
  const limiter = await rateLimit(ip, 300, 60000);
  if (!limiter.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    const data = checkinSyncSchema.parse(body);

    const result = await SongsueSyncService.syncAttendedFromSongsue(data, ip);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    if (error instanceof SongsueSyncError && error.message === "EVENT_NOT_SONGSUE_LINKED") {
      return NextResponse.json({ error: "Event is not linked to Songsue" }, { status: 404 });
    }
    if (error instanceof SongsueSyncError && error.message === "EVENT_HAS_NO_SESSION") {
      return NextResponse.json({ error: "Event has no session to attach attendance to" }, { status: 409 });
    }
    console.error("Songsue check-in sync error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
