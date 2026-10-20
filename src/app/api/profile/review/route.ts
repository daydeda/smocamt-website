import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";

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
    const stamped = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ profileReviewedAt: reviewedAt })
        .where(and(eq(users.id, userId), eq(users.profileCompleted, true)))
        .returning({ id: users.id });
      if (!row) return false;
      await AuditService.logActionInternal(tx, {
        actorId: userId,
        targetId: userId,
        action: "Self: confirmed profile info unchanged (periodic review)",
        ipAddress: getClientIp(req),
      });
      return true;
    });

    if (!stamped) {
      return NextResponse.json({ error: "Profile not completed" }, { status: 400 });
    }
    return NextResponse.json({ success: true, profileReviewedAt: reviewedAt });
  } catch (error) {
    console.error("Profile review error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
