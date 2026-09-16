import { auth } from "@/auth";
import { db } from "@/db";
import { shopSellers } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const applicationSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
});

// GET /api/shop/seller — the signed-in account's own seller application.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [seller] = await db
      .select({
        id: shopSellers.id,
        displayName: shopSellers.displayName,
        status: shopSellers.status,
        reviewNote: shopSellers.reviewNote,
        appliedAt: shopSellers.appliedAt,
        reviewedAt: shopSellers.reviewedAt,
      })
      .from(shopSellers)
      .where(eq(shopSellers.userId, session.user.id!))
      .limit(1);

    return NextResponse.json({ seller: seller ?? null });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/shop/seller — apply (or re-apply after rejection) to sell. Google
// email domain is deliberately irrelevant; completed onboarding + admin review
// are the identity/trust gates.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.profileCompleted) {
      return NextResponse.json({ error: "Complete onboarding before applying to sell." }, { status: 403 });
    }

    const data = applicationSchema.parse(await req.json());

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: shopSellers.id, status: shopSellers.status })
        .from(shopSellers)
        .where(eq(shopSellers.userId, session.user.id!))
        .limit(1);

      if (existing?.status === "approved") return { conflict: "Your seller account is already approved." };
      if (existing?.status === "pending") return { conflict: "Your seller application is already pending." };
      if (existing?.status === "suspended") return { conflict: "This seller account is suspended. Contact a shop administrator." };

      if (existing) {
        await tx
          .update(shopSellers)
          .set({
            displayName: data.displayName,
            status: "pending",
            reviewNote: null,
            appliedAt: new Date(),
            reviewedBy: null,
            reviewedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(shopSellers.id, existing.id));
      } else {
        await tx.insert(shopSellers).values({
          userId: session.user.id!,
          displayName: data.displayName,
          status: "pending",
        });
      }

      await AuditService.logActionInternal(tx, {
        actorId: session.user.id!,
        action: existing ? "Re-applied for shop seller access" : "Applied for shop seller access",
        ipAddress: getClientIp(req),
      });
      return { success: true as const };
    });

    if ("conflict" in result) {
      return NextResponse.json({ error: result.conflict }, { status: 409 });
    }
    return NextResponse.json({ success: true }, { status: 201 });
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
