import { db } from "@/db";
import { prizes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PrizeService } from "@/modules/events/prize.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { NextResponse } from "next/server";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/prizes/[id]/awaiting-photo — the claims for this prize that
// were confirmed but never got a proof photo attached (venue wifi died mid
// upload, staff moved on, etc). Backs the "รอรูป" follow-up list so those
// claims are actually reachable later instead of only ever mentioned in the
// booth's failure copy. Gated like the full claim list (canManage): it is the
// same class of data (names + รหัสนักศึกษา across a roster), just filtered.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid prize id" }, { status: 400 });
    }

    const prize = await db.query.prizes.findFirst({ where: eq(prizes.id, id) });
    if (!prize) return NextResponse.json({ error: "Prize not found" }, { status: 404 });
    if (!(await canReachPrize(access, prize))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const claims = await PrizeService.listAwaitingPhoto(id);
    return NextResponse.json({ claims });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/prizes/[id]/awaiting-photo" });
    return NextResponse.json({ error: "Failed to load claims" }, { status: 500 });
  }
}
