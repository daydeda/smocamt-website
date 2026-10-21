import { BattleService } from "@/modules/battle/battle.service";
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

    const leaderboard = await BattleService.listLeaderboard(gameType);

    return NextResponse.json({
      leaderboard,
    });

  } catch (error) {
    captureException(error, { route: "GET /api/battle/leaderboard" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
