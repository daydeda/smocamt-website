import { auth } from "@/auth";
import { CalendarService } from "@/modules/calendar/calendar.service";
import { NextResponse } from "next/server";

// GET /api/calendar/feed/token — return the caller's feed token, lazily creating
// one on first request so the Subscribe panel always has a URL to show.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;

  const token = await CalendarService.getOrCreateFeedToken(userId);

  return NextResponse.json({ token });
}

// POST /api/calendar/feed/token — rotate: issue a new token, instantly killing
// the old subscribe URL.
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;
  const token = await CalendarService.rotateFeedToken(userId);

  return NextResponse.json({ token });
}

// DELETE /api/calendar/feed/token — revoke entirely (no active feed afterwards).
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await CalendarService.revokeFeedToken(session.user.id!);
  return NextResponse.json({ success: true });
}
