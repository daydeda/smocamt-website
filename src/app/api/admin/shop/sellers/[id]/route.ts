import { auth } from "@/auth";
import { isShopAdmin } from "@/lib/shop/shop-auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { ShopAdminService } from "@/modules/shop/shop-admin.service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "suspend"]),
  note: z.string().trim().max(500).optional(),
});

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

    const outcome = await ShopAdminService.reviewSeller(id, data, session!.user!.id!, getClientIp(req));

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
