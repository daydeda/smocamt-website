import { auth } from "@/auth";
import { EventsService } from "@/modules/events/events.service";
import { NextResponse } from "next/server";
import { getClientIp } from "@/modules/audit/audit.service";
import { canEditEventDirectly, effectiveRoles } from "@/lib/access/admin-access";
import { syncEventToSongsue } from "@/lib/integrations/songsue-sync";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/admin/events/[id]/go-live — start a not-yet-started event early.
//
// "Live" everywhere in the app is purely time-based (now within startTime..endTime),
// so there's no status flag to flip: going live early means moving the start time
// to now. The event's start AND its first session's start move together, so the
// scanner's live badge, its default day, and the server's current-session pick all
// agree. Same power as editing the event's schedule, so it uses the same gate as
// the staff edit (canEditEventDirectly) — presidents' schedule edits go through
// review and can't take this shortcut.
//
// Only allowed on the event's own start day (Asia/Bangkok): pulling a multi-day
// event's Day 1 forward across midnight would give that session a cross-day span,
// which the event editor rejects (sessionsHaveInvalidSpan).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user?.id || !canEditEventDirectly(myRoles, session.user.smoPosition, session.user.anusmoPosition)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const now = new Date();
    const ip = getClientIp(req);

    let result: Awaited<ReturnType<typeof EventsService.goLiveNow>>;
    try {
      result = await EventsService.goLiveNow(id, now, session.user.id!, ip);
    } catch (e) {
      if (e instanceof Error && e.message === "EVENT_NOT_FOUND") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      if (e instanceof Error && e.message === "ALREADY_STARTED") {
        return NextResponse.json({ error: "This event has already started" }, { status: 409 });
      }
      if (e instanceof Error && e.message === "NOT_TODAY") {
        return NextResponse.json({ error: "Only an event starting later today can be started early" }, { status: 409 });
      }
      throw e;
    }

    const { event: updated, sessions } = result;

    // Best-effort mirror into Songsue, same as a staff edit of the schedule.
    if (updated.songsueLinked) {
      const staff = updated.staffUserIds && updated.staffUserIds.length > 0
        ? await EventsService.listStaffContacts(updated.staffUserIds)
        : [];
      await syncEventToSongsue({
        externalId: updated.id,
        title: updated.title,
        description: updated.description,
        startTime: updated.startTime.toISOString(),
        endTime: updated.endTime.toISOString(),
        location: updated.location,
        pointsAwarded: updated.pointsAwarded,
        individualPointsAwarded: updated.individualPointsAwarded,
        walkInsEnabled: updated.walkInsEnabled,
        quota: updated.quota,
        quotaWalkIn: updated.quotaWalkIn,
        imageUrl: updated.imageUrl,
        imageUrls: updated.imageUrls,
        staff,
      });
    }

    return NextResponse.json({
      success: true,
      startTime: updated.startTime.toISOString(),
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        sortOrder: s.sortOrder,
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
