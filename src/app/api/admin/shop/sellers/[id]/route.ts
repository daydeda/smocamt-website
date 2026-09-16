import { auth } from "@/auth";
import { db } from "@/db";
import { shopSellers, users } from "@/db/schema";
import { isShopAdmin } from "@/lib/shop-auth";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "suspend"]),
  note: z.string().trim().max(500).optional(),
});

const ROLE_PRIORITY = [
  "super_admin", "admin", "registration", "organizer", "smo", "anusmo",
  "club_president", "major_president", "shop_seller", "staff", "professor",
  "officer", "student",
];

function nextRoles(current: string[] | null, fallback: string | null, approved: boolean): string[] {
  const roles = new Set(current?.length ? current : [fallback || "student"]);
  if (approved) roles.add("shop_seller");
  else roles.delete("shop_seller");
  if (roles.size === 0) roles.add("student");
  return [...roles];
}

// PATCH /api/admin/shop/sellers/[id] — approve/reject/suspend an application.
// The seller capability and review state move in the same transaction.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!isShopAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = reviewSchema.parse(await req.json());
    if (data.action !== "approve" && !data.note) {
      return NextResponse.json({ error: "A review note is required." }, { status: 400 });
    }

    const outcome = await db.transaction(async (tx) => {
      const [seller] = await tx
        .select({ id: shopSellers.id, userId: shopSellers.userId, status: shopSellers.status })
        .from(shopSellers)
        .where(eq(shopSellers.id, id))
        .limit(1)
        .for("update");
      if (!seller) return { notFound: true as const };

      const [user] = await tx
        .select({ role: users.role, roles: users.roles })
        .from(users)
        .where(eq(users.id, seller.userId))
        .limit(1)
        .for("update");
      if (!user) return { notFound: true as const };

      const approved = data.action === "approve";
      const status = approved ? "approved" : data.action === "reject" ? "rejected" : "suspended";
      const roles = nextRoles(user.roles, user.role, approved);
      const primaryRole = ROLE_PRIORITY.find((role) => roles.includes(role)) ?? roles[0] ?? "student";

      await tx
        .update(shopSellers)
        .set({
          status,
          reviewNote: data.note || null,
          reviewedBy: session!.user!.id!,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shopSellers.id, seller.id));

      await tx
        .update(users)
        .set({ role: primaryRole, roles, updatedAt: new Date() })
        .where(eq(users.id, seller.userId));

      await AuditService.logActionInternal(tx, {
        actorId: session!.user!.id!,
        targetId: seller.userId,
        action: `${data.action === "approve" ? "Approved" : data.action === "reject" ? "Rejected" : "Suspended"} shop seller ${seller.id} (${seller.status} → ${status})`,
        ipAddress: getClientIp(req),
      });

      return { status };
    });

    if ("notFound" in outcome) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, status: outcome.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 },
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
