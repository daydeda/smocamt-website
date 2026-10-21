import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getClientIp } from "@/modules/audit/audit.service";
import { HousesService } from "@/modules/houses/houses.service";
import { captureException } from "@/lib/util/logger";
import { revalidateLeaderboards } from "@/lib/points/leaderboard-cache";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || !["super_admin", "admin"].includes(session.user.role || "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { houseId, delta, reason } = body;

    if (!houseId || delta === undefined || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Bound manual adjustments so a typo (or a misused admin account) can't
    // swing the leaderboard by millions in one request. Large corrections are
    // still possible — they just take several audited steps.
    const MAX_DELTA = 10000;
    const parsedDelta = parseInt(delta);
    if (isNaN(parsedDelta) || Math.abs(parsedDelta) > MAX_DELTA) {
      return NextResponse.json(
        { error: `Invalid delta: must be an integer between -${MAX_DELTA} and ${MAX_DELTA}` },
        { status: 400 }
      );
    }

    await HousesService.adjustPoints({ houseId, delta: parsedDelta, reason, actorId: session.user!.id!, ipAddress: getClientIp(req) });

    // Bust the cached leaderboard so this manual adjustment appears on the next
    // poll instead of waiting out the 15s cache window.
    revalidateLeaderboards();

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, { route: "POST /api/admin/houses/points" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
