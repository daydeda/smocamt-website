import { buildViewer } from "@/lib/access/event-access";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { CalendarService, getCalendarItemsForViewer } from "@/modules/calendar/calendar.service";
import { buildVCalendar, type CalItem } from "@/lib/calendar/ical";

export const maxDuration = 20;

const DAY_MS = 86_400_000;

// PUBLIC, token-authenticated .ics subscribe feed.
//
// This route is intentionally reachable WITHOUT a session: src/proxy.ts (matcher
// at proxy.ts:87) never runs on /api/* paths, and we do NOT call auth() here. The
// per-user secret token IS the authentication — a calendar app polling this URL
// in the background can't carry a Google session. Do NOT "fix" the public access
// by adding a path to proxy.ts isPublicPath (irrelevant for /api) or by gating
// /api in the proxy matcher; the token is validated server-side below.
//
// PDPA: the URL is a bearer credential — anyone with the link sees this user's
// eligible event/entry titles, times, and locations. No medical data is exposed
// (entries/events carry none), so no audit-log write is required. The token is
// rotatable/revocable via /api/calendar/feed/token.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) return new Response("Not found", { status: 404 });

    const tokenRow = await CalendarService.findFeedTokenRow(token);
    if (!tokenRow) return new Response("Not found", { status: 404 });

    const user = await CalendarService.findFeedUser(tokenRow.userId);
    if (!user) return new Response("Not found", { status: 404 });

    const clubIds = await ClubsService.getMemberClubIds(user.id);
    const viewer = buildViewer({
      roles: user.roles ?? (user.role ? [user.role] : ["student"]),
      studentId: user.studentId,
      major: user.major,
      clubIds,
    });

    const items = await getCalendarItemsForViewer(viewer, user.id);

    // Bound the window (−90d … +365d) to keep subscribed clients' polls small.
    const now = Date.now();
    const lower = now - 90 * DAY_MS;
    const upper = now + 365 * DAY_MS;
    const origin = new URL(req.url).origin;

    const calItems: CalItem[] = items
      .filter((it) => {
        const baseStart = new Date(it.startTime).getTime();
        const until = it.recurrenceUntil ? new Date(it.recurrenceUntil).getTime() : null;
        // A recurring series is in-window if it starts before the window closes AND
        // its until-date (if set) hasn't already passed before the window opened.
        if (it.recurrence !== "none") {
          return baseStart <= upper && (until === null || until >= lower);
        }
        return baseStart >= lower && baseStart <= upper;
      })
      .map((it) => ({
        uid: `${it.kind}-${it.id}`,
        title: it.title,
        description: it.description,
        location: it.location,
        start: new Date(it.startTime),
        end: new Date(it.endTime),
        allDay: it.allDay,
        url:
          it.kind === "event"
            ? `${origin}/dashboard`
            : `${origin}/dashboard/calendar`,
        updatedAt: it.updatedAt ? new Date(it.updatedAt) : null,
        recurrence: it.recurrence,
        recurrenceUntil: it.recurrenceUntil ? new Date(it.recurrenceUntil) : null,
      }));

    const ics = buildVCalendar(calItems);

    // Best-effort lastUsedAt bump — never fail the feed if this errors.
    CalendarService.touchFeedTokenLastUsed(token)
      .catch(() => {});

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="activecamt.ics"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
