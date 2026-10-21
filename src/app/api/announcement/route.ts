import { AnnouncementService } from "@/modules/announcement/announcement.service";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { captureException } from "@/lib/util/logger";

// Cache the singleton read at the app layer for 30s. The s-maxage header only helps
// behind a CDN (Vercel); self-hosted behind plain nginx there is none, so without
// this every student device polling the banner hits the DB. Revalidate the
// "dashboard-announcement" tag after an edit to refresh sooner than 30s.
const getAnnouncement = unstable_cache(
  async () => {
    return AnnouncementService.getCurrent();
  },
  ["dashboard-announcement"],
  { revalidate: 30, tags: ["dashboard-announcement"] },
);

// GET /api/announcement — public. Returns the singleton dashboard announcement
// ({ body, enabled }) read by the student dashboard banner. The table is treated
// as a singleton, so we read the most-recently-updated row. Returns null if none.
//
// CDN-cached (mirrors /api/houses): the banner changes a few times a week at most,
// but every student device polls it. s-maxage lets the edge serve it without
// invoking the function for 30s, so an edit appears within ~30s instead of hitting
// the DB on every poll.
export async function GET() {
  try {
    const row = await getAnnouncement();

    return NextResponse.json(row ?? null, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    captureException(error, { route: "GET /api/announcement" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
