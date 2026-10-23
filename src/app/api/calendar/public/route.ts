import { getCalendarItemsForGuest } from "@/modules/calendar/calendar.service";
import { buildVCalendar, toCalItems } from "@/lib/calendar/ical";

export const maxDuration = 20;

// PUBLIC .ics feed of what a logged-out visitor can see (guest-eligible events and
// calendar entries only, same predicate as GET /api/calendar with no session). No
// token and no session: nothing here is personal, so no audit write is needed. The
// personal, token-authenticated feed lives at /api/calendar/feed/[token].
export async function GET(req: Request) {
  try {
    const origin = new URL(req.url).origin;
    const items = await getCalendarItemsForGuest();
    const ics = buildVCalendar(toCalItems(items, origin, Date.now()));
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="activecamt-public.ics"',
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
