import { auth } from "@/auth";
import { HousesService } from "@/modules/houses/houses.service";
import { NextResponse } from "next/server";

// Returns the current user's individual standing: their points, their exact
// rank across all profile-completed students, and the total student count.
// Rank is computed in SQL (count of students with strictly more points + 1) so
// it stays correct even when the user is outside the top-50 leaderboard list.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const me = await HousesService.getUserStandingProfile(session.user.id);

    if (!me || !me.profileCompleted) {
      return NextResponse.json({ points: 0, rank: null, total: 0 });
    }

    const myPoints = me.points ?? 0;

    const { total, ahead } = await HousesService.getStandingCounts(myPoints);

    // With 0 points you haven't earned a position yet — and when everyone is at 0
    // a numeric rank would just tie everybody at #1, which is misleading. Report
    // rank: null ("Unranked") until at least 1 point is earned.
    const rank = myPoints > 0 ? Number(ahead) + 1 : null;

    return NextResponse.json(
      { points: myPoints, rank, total: Number(total) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Failed to fetch individual standing:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
