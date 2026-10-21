import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getClientIp } from "@/modules/audit/audit.service";
import { UsersService } from "@/modules/users/users.service";

// POST: the student confirms their existing personal/medical/emergency info is
// still correct. Only stamps profileReviewedAt — no profile fields are touched.
// (Saving edits through PATCH /api/profile stamps it too.)
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const reviewedAt = new Date();
    const stamped = await UsersService.stampProfileReviewed(userId, reviewedAt, getClientIp(req));

    if (!stamped) {
      return NextResponse.json({ error: "Profile not completed" }, { status: 400 });
    }
    return NextResponse.json({ success: true, profileReviewedAt: reviewedAt });
  } catch (error) {
    console.error("Profile review error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
