import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { checkEventRepush, claimEventRepush, sendEventRepush, type RepushCheck } from "@/modules/notifications/new-event.service";
import { after, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

// Re-sending a push reaches every eligible student, so only super_admin/admin may do it.
// Full roles array, not just the primary role (a user can hold several roles).
function canRepush(session: Session | null): boolean {
  if (!session?.user) return false;
  const roles = session.user.roles ?? (session.user.role ? [session.user.role] : []);
  return roles.some((r) => r === "super_admin" || r === "admin");
}

function refusal(check: Exclude<RepushCheck, { ok: true }>) {
  switch (check.reason) {
    case "not_found":
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    case "hidden":
      return NextResponse.json({ error: "This event is not open to students", reason: "hidden" }, { status: 409 });
    case "started":
      return NextResponse.json({ error: "This event has already started", reason: "started" }, { status: 409 });
    case "cooldown":
      return NextResponse.json(
        { error: "A push for this event was sent recently", reason: "cooldown", retryAfterMs: check.retryAfterMs },
        { status: 429 },
      );
  }
}

// GET /api/admin/events/[id]/repush — preview: may it be re-sent now, and to how many people.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!canRepush(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const check = await checkEventRepush(id);
    if (!check.ok) return refusal(check);
    return NextResponse.json({ audienceCount: check.audience.length });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/admin/events/[id]/repush — re-send the event's push (audit-logged, 1h cooldown).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!canRepush(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const check = await claimEventRepush(id, session!.user!.id!, getClientIp(req));
    if (!check.ok) return refusal(check);
    after(() => sendEventRepush(check.event, check.audience));
    return NextResponse.json({ success: true, audienceCount: check.audience.length });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
