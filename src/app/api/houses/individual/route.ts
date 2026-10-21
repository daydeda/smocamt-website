import { auth } from "@/auth";
import { HousesService } from "@/modules/houses/houses.service";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { captureException } from "@/lib/util/logger";

// The individual standings are the same global ranking for every viewer, so cache
// the read for 15s and share it across all polling clients — decoupling DB cost
// from how many students are watching at once. Keyed on page/limit (unstable_cache
// includes the function args in its key). The auth() gate stays OUTSIDE the cache.
const getIndividualStandings = unstable_cache(
  (page: number, limit: number) => HousesService.listIndividualStandings(page, limit),
  ["individual-standings"],
  { revalidate: 15, tags: ["individual-standings"] },
);

export async function GET(req: Request) {
  try {
    // PDPA: the individual standings expose real student names — authenticated users only.
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    // Default to the full leaderboard (the standings page paginates client-side).
    // The 2000 ceiling is just a safety valve against a pathological payload — the
    // result set is small (a few hundred students), the response is edge-cached for
    // 30s, and the page only renders 10 rows at a time, so returning all is cheap.
    const limit = Math.min(2000, Math.max(1, parseInt(searchParams.get("limit") || "2000")));

    const list = await getIndividualStandings(page, limit);

    return NextResponse.json(list, {
      headers: {
        // Private: response contains student PII and is now auth-gated, so it must
        // not be stored by the shared Vercel CDN. Per-browser caching only.
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    captureException(error, { route: "GET /api/houses/individual" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
