import { auth } from "@/auth";
import { getClientIp } from "@/modules/audit/audit.service";
import { ShopAdminService } from "@/modules/shop/shop-admin.service";
import { resolveShopAccess } from "@/lib/shop/shop-scope";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  enabled: z.boolean(),
  paymentInfo: z.string().max(5000),
  // Bare string (not .url()): the self-hosted /api/upload returns relative paths
  // like "/uploads/x.jpg" (see shop-product-schema.ts imageUrls for the same note).
  qrImageUrl: z.string().nullable().or(z.literal("").transform(() => null)),
  // Delivery config (flat fee). deliveryFee in whole ฿.
  deliveryEnabled: z.boolean().default(false),
  deliveryFee: z.number().int().min(0).max(100000).default(0),
  pickupInfo: z.string().max(5000).default(""),
});

// GET /api/admin/shop/settings — current singleton for the admin settings form.
export async function GET() {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!access.unscoped) {
      if (!access.sellerId) {
        return NextResponse.json({ error: "Seller approval is required before adding payment settings." }, { status: 403 });
      }
      const seller = await ShopAdminService.getSellerPaymentSettings(access.sellerId);
      if (!seller) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ ...seller, enabled: true, mode: "seller" });
    }
    const row = await ShopAdminService.getGlobalSettingsForAdmin();
    return NextResponse.json({
      ...(row ?? { enabled: false, paymentInfo: "", qrImageUrl: null, deliveryEnabled: false, deliveryFee: 0, pickupInfo: "" }),
      mode: "global",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT /api/admin/shop/settings — upsert the singleton shop settings + audit log.
export async function PUT(req: Request) {
  try {
    const session = await auth();
    const access = await resolveShopAccess(session);
    if (!access.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const data = settingsSchema.parse(await req.json());

    if (!access.unscoped && !access.sellerId) {
      return NextResponse.json({ error: "Seller approval is required before adding payment settings." }, { status: 403 });
    }

    await ShopAdminService.saveSettings({
      unscoped: access.unscoped,
      sellerId: access.unscoped ? null : access.sellerId,
      userId: access.userId,
      data,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
