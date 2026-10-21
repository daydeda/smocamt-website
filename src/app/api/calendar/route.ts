import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { buildViewer } from "@/lib/access/event-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import {
  getCalendarItemsForGuest,
  getCalendarItemsForViewer,
} from "@/modules/calendar/calendar.service";

// Fail fast instead of hanging to the platform default if the pooler stalls.
export const maxDuration = 20;

// GET /api/calendar — events + calendar entries the caller may see, filtered by
// the same eligibility predicate as /api/events. Each item is tagged
// kind: "event" | "entry" so the grid can style/route them.
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(await getCalendarItemsForGuest());
    }

    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id!),
      columns: { major: true },
    });
    const clubIds = await ClubsService.getMemberClubIds(session.user.id!);
    const viewer = buildViewer({
      roles: session.user.roles || [session.user.role || "student"],
      studentId: session.user.studentId,
      major: me?.major,
      clubIds,
    });

    const items = await getCalendarItemsForViewer(viewer, session.user.id!);
    return NextResponse.json(items);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
