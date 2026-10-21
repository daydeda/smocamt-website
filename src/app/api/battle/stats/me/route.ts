import { BattleService } from "@/modules/battle/battle.service";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureException } from "@/lib/util/logger";

// GET /api/battle/stats/me - Retrieve my OX stats and match history
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }


    const userId = session.user.id;

    const stats = await BattleService.getMyStats(userId);

    const history = await BattleService.listMyMatchHistory(userId);

    return NextResponse.json({
      stats: stats ?? null,
      history,
    });

  } catch (error) {
    captureException(error, { route: "GET /api/battle/stats/me" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
