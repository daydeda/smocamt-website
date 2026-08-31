import { auth } from "@/auth";
import { db } from "@/db";
import { shopOrders } from "@/db/schema";
import { downloadSlip } from "@/lib/shop-storage";
import { isShopAdmin } from "@/lib/shop-auth";
import { resolveShopAccess, classifyOrdersByScope } from "@/lib/shop-scope";
import { eq } from "drizzle-orm";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// An order id is always a UUID; reject a malformed path before the DB query.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/shop/orders/[id]/slip — stream the payment slip bytes. PDPA-gated: only
// the buyer who placed the order or a shop admin may view it. The slip is proxied
// through here (never a public URL), so access is checked on every request.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const [order] = await db
      .select({ buyerId: shopOrders.buyerId, slipPath: shopOrders.slipPath })
      .from(shopOrders)
      .where(eq(shopOrders.id, id))
      .limit(1);

    if (!order || !order.slipPath) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isOwner = order.buyerId === session.user.id;
    let scopedOk = false;
    if (!isOwner && !isShopAdmin(session)) {
      // A scoped president may view the slip only for an order that is entirely
      // for products their club/major owns (same rule as reviewing it).
      const access = await resolveShopAccess(session);
      if (access.ok && !access.unscoped) {
        const info = (await classifyOrdersByScope([id], access.scope)).get(id);
        scopedOk = !!info?.anyOwned && !!info?.fullyOwned;
      }
      if (!scopedOk) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { buffer, contentType } = await downloadSlip(order.slipPath);

    // PDPA: a shop admin viewing a buyer's payment slip (not the buyer themselves)
    // leaves a trail. Best-effort — never block the view on an audit hiccup.
    if (!isOwner) {
      try {
        await AuditService.logAction({
          actorId: session.user.id!,
          targetId: order.buyerId ?? undefined,
          action: `Viewed payment slip for shop order ${id}`,
          ipAddress: getClientIp(req),
        });
      } catch (e) {
        console.error("Failed to audit slip view:", e);
      }
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        // Never let a browser MIME-sniff a stored slip into something executable.
        "X-Content-Type-Options": "nosniff",
        // Private: caches must revalidate auth, never store shared copies.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
