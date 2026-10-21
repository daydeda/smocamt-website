import { auth } from "@/auth";
import { db } from "@/db";
import { scoreHistory } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { captureException } from "@/lib/util/logger";

// The activity feed is identical for every viewer, so cache the read for 15s and
// share it across all polling clients — one query per window instead of one per
// student. The auth() gate stays OUTSIDE the cache so access control is unchanged.
const getHouseActivity = unstable_cache(
  () =>
    db.query.scoreHistory.findMany({
      limit: 20,
      orderBy: [desc(scoreHistory.timestamp)],
      with: {
        house: {
          columns: {
            id: true,
            name: true,
            color: true,
          },
        },
        event: {
          columns: {
            title: true,
          },
        },
      },
    }),
  ["house-activity"],
  { revalidate: 15 },
);

export async function GET() {
  try {
    // PDPA: score-history reason strings can embed student names — auth required.
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const list = await getHouseActivity();

    return NextResponse.json(list);
  } catch (error) {
    captureException(error, { route: "GET /api/houses/activity" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
