import { db } from "@/db";
import { prizes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PrizeService } from "@/modules/events/prize.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { AuditService } from "@/modules/audit/audit.service";
import { getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/prizes/[id]/awaiting-photo — the claims for this prize that
// were confirmed but never got a proof photo attached (venue wifi died mid
// upload, staff moved on, etc). Backs the "รอรูป" follow-up list so those
// claims are actually reachable later instead of only ever mentioned in the
// booth's failure copy.
//
// Gated on canAward (not canManage): this is award-tier data, not report-tier
// data — names + รหัสนักศึกษา for people this staffer just handed a prize to,
// one prize at a time, with no face photos in it (PrizeService.listAwaitingPhoto
// selects only claimId/name/studentId/claimedAt). The thing an award-only role
// (smo) is deliberately kept away from is the dean report (every winner + face
// photo in one forwardable file) — that stays canExport-only and is untouched
// here. POST .../claims/[claimId]/photo already allows canAward ("whoever may
// award may also complete the record"); this route is what lets that role
// actually FIND the claim to attach to, instead of only being able to attach
// one it already happens to know the id of.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!access.canAward) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

    // The accountability mechanism for admitting an award-only role (smo) to
    // this list is the audit log, same as the claim-photo view route. A
    // canManage viewer already sees this same data inline on the prizes page
    // (claimCount etc.), so only log the narrower award-only access.
    if (!access.canManage) {
      try {
        await AuditService.logAction({
          actorId: access.userId,
          action: `Viewed awaiting-photo list for prize "${prize.name}" (${id}) — ${claims.length} claim(s)`,
          ipAddress: getClientIp(req),
        });
      } catch (e) {
        console.error("Failed to audit awaiting-photo list view:", e);
      }
    }

    return NextResponse.json({ claims });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/prizes/[id]/awaiting-photo" });
    return NextResponse.json({ error: "Failed to load claims" }, { status: 500 });
  }
}
