import { auth } from "@/auth";
import { db } from "@/db";
import { events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";
import { syncEventToSongsue } from "@/lib/songsue-sync";

export const dynamic = "force-dynamic";

// POST /api/admin/events/[id]/songsue-resync — manually re-fire the event-level
// Songsue mirror (src/lib/songsue-sync.ts). songsue-sync.ts has no retry queue in
// v1: if the original syncEventToSongsue call failed (Songsue down, network blip,
// etc.) the event silently never lands on Songsue's side, and every subsequent
// registration sync 404s with "Event has not been synced from ActiveCAMT yet"
// forever. This lets staff recover without needing a code deploy.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    const isAdminRole = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
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
    });

    await db.transaction(async (tx) => {
      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: `Manually resynced Event to Songsue: ${event.title}`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
