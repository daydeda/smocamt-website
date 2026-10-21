import { auth } from "@/auth";
import { isShopAdmin } from "@/lib/shop/shop-auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { ShopAdminService } from "@/modules/shop/shop-admin.service";
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

    const sellers = await ShopAdminService.listSellerApplications(session!.user!.id!, getClientIp(req));

    return NextResponse.json(sellers);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
