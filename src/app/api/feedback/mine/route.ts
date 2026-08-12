import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { FeedbackService } from "@/modules/feedback/feedback.service";

export const dynamic = "force-dynamic";

// GET /api/feedback/mine — the logged-in user's own submissions, matched via
// their own re-derived submitterRef (src/lib/feedback-token.ts). Safe under
// the anonymity model (docs/features/feedback-complaints.md §5): this route
// takes NO id from the client at all, it only ever computes the lookup key
// from the caller's own session — so there is no path for anyone, including
// an admin, to use this endpoint to look up someone else's submissions.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const complaints = await FeedbackService.listMine(session.user.id);
    return NextResponse.json({ complaints });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
