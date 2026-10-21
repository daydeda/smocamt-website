import { db } from "@/db";
import { gameStats } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureException } from "@/lib/util/logger";

// GET /api/battle/leaderboard - Retrieve top players sorted by wins DESC
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }


    const { searchParams } = new URL(req.url);
    const gameType = searchParams.get("game") || "ox";

    if (gameType !== "ox") {
      return NextResponse.json({ error: "Unsupported game type" }, { status: 400 });
    }

    const leaderboard = await db.query.gameStats.findMany({
      where: (gs, { eq }) => eq(gs.gameType, gameType),
      orderBy: [desc(gameStats.wins), desc(gameStats.winStreak)],
      limit: 20,
      with: {
        user: {
          columns: { id: true, name: true, nickname: true, houseId: true, image: true }
        }
      }
    });

    return NextResponse.json({
      leaderboard,
    });

  } catch (error) {
    captureException(error, { route: "GET /api/battle/leaderboard" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
