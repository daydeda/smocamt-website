import { auth } from "@/auth";
import { db } from "@/db";
import { shopSellers, users } from "@/db/schema";
import { isShopAdmin } from "@/lib/shop-auth";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/admin/shop/sellers — marketplace application/review queue. Shop
// reviewers are super_admin/admin and the SMO Finance position.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!isShopAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sellers = await db
      .select({
        id: shopSellers.id,
        userId: shopSellers.userId,
        displayName: shopSellers.displayName,
        status: shopSellers.status,
        reviewNote: shopSellers.reviewNote,
        appliedAt: shopSellers.appliedAt,
        reviewedAt: shopSellers.reviewedAt,
        accountName: users.name,
        accountEmail: users.email,
      })
      .from(shopSellers)
      .innerJoin(users, eq(users.id, shopSellers.userId))
      .orderBy(desc(shopSellers.appliedAt));

    await AuditService.logAction({
      actorId: session!.user!.id!,
      action: `Viewed shop seller review queue (${sellers.length} applications; included account name/email)`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(sellers);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
