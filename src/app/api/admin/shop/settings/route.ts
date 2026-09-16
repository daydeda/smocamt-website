import { auth } from "@/auth";
import { db } from "@/db";
import { shopSellers, shopSettings } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { resolveShopAccess } from "@/lib/shop-scope";
import { desc, eq } from "drizzle-orm";
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
      const [seller] = await db
        .select({
          paymentInfo: shopSellers.paymentInfo,
          qrImageUrl: shopSellers.qrImageUrl,
          deliveryEnabled: shopSellers.deliveryEnabled,
          deliveryFee: shopSellers.deliveryFee,
          pickupInfo: shopSellers.pickupInfo,
        })
        .from(shopSellers)
        .where(eq(shopSellers.id, access.sellerId))
        .limit(1);
      if (!seller) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ ...seller, enabled: true, mode: "seller" });
    }
    const [row] = await db
      .select({
        enabled: shopSettings.enabled,
        paymentInfo: shopSettings.paymentInfo,
        qrImageUrl: shopSettings.qrImageUrl,
        deliveryEnabled: shopSettings.deliveryEnabled,
        deliveryFee: shopSettings.deliveryFee,
        pickupInfo: shopSettings.pickupInfo,
      })
      .from(shopSettings)
      .orderBy(desc(shopSettings.updatedAt))
      .limit(1);
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

    await db.transaction(async (tx) => {
      if (!access.unscoped) {
        await tx
          .update(shopSellers)
          .set({
            paymentInfo: data.paymentInfo,
            qrImageUrl: data.qrImageUrl,
            deliveryEnabled: data.deliveryEnabled,
            deliveryFee: data.deliveryFee,
            pickupInfo: data.pickupInfo,
            updatedAt: new Date(),
          })
          .where(eq(shopSellers.id, access.sellerId!));
      } else {
        const [existing] = await tx
          .select({ id: shopSettings.id })
          .from(shopSettings)
          .orderBy(desc(shopSettings.updatedAt))
          .limit(1);

        if (existing) {
          await tx
            .update(shopSettings)
            .set({
              enabled: data.enabled,
              paymentInfo: data.paymentInfo,
              qrImageUrl: data.qrImageUrl,
              deliveryEnabled: data.deliveryEnabled,
              deliveryFee: data.deliveryFee,
              pickupInfo: data.pickupInfo,
              updatedBy: session!.user!.id!,
              updatedAt: new Date(),
            })
            .where(eq(shopSettings.id, existing.id));
        } else {
          await tx.insert(shopSettings).values({
            enabled: data.enabled,
            paymentInfo: data.paymentInfo,
            qrImageUrl: data.qrImageUrl,
            deliveryEnabled: data.deliveryEnabled,
            deliveryFee: data.deliveryFee,
            pickupInfo: data.pickupInfo,
            updatedBy: session!.user!.id!,
          });
        }
      }

      await AuditService.logActionInternal(tx, {
        actorId: access.userId,
        action: access.unscoped
          ? `Updated global shop settings (enabled: ${data.enabled})`
          : `Updated seller payment and fulfilment settings (${access.sellerId})`,
        ipAddress: getClientIp(req),
      });
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
