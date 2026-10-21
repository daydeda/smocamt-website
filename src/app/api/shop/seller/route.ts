import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { ShopService } from "@/modules/shop/shop.service";
import { getShopAdminUserIds } from "@/modules/notifications/push-audience";
import { PushService } from "@/modules/notifications/push.service";
import { after, NextResponse } from "next/server";
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

    const seller = await ShopService.getOwnSellerApplication(session.user.id!);

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

    const result = await ShopService.applyToSell(session.user.id!, data.displayName, getClientIp(req));

    if ("conflict" in result) {
      return NextResponse.json({ error: result.conflict }, { status: 409 });
    }

    after(async () => {
      const adminIds = await getShopAdminUserIds();
      await PushService.sendToUserIds(adminIds, {
        title: "New shop seller application",
        body: `${data.displayName} applied to sell in the shop.`,
        url: "/admin/shop",
        tag: `seller-application:${session.user!.id}`,
      });
    });

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
