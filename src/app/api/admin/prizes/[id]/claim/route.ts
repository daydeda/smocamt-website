import { db } from "@/db";
import { prizes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PrizeService } from "@/modules/events/prize.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/logger";

// POST /api/admin/prizes/[id]/claim — the booth endpoint.
//
// action "preview" resolves the scanned QR and says what WOULD happen (writes
// nothing); action "confirm" writes the claim. Two steps on purpose: staff must
// see "รับไปแล้วเมื่อ ..." BEFORE physically handing the item over, not after.
//
// The photo is NOT uploaded here — the claim commits first (see PrizeService),
// so a dead venue wifi can't stop staff recording handovers, which would also
// switch the duplicate check off for everyone behind them in the queue.

// Match the scanner's budget: the booth must stay responsive under load rather
// than hanging to the platform default.
export const maxDuration = 20;

const schema = z.object({
  action: z.enum(["preview", "confirm"]).default("preview"),
  // A scanned QR token, or a userId picked from the manual-search fallback.
  // Never a free-text name/รหัสนักศึกษา: a claim must point at a real users row.
  qrToken: z.string().min(1).optional(),
  studentUserId: z.string().min(1).optional(),
  eventId: z.string().uuid().nullish(),
  note: z.string().trim().max(500).nullish(),
}).refine((v) => !!v.qrToken || !!v.studentUserId, {
  message: "qrToken or studentUserId is required",
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req);
  // Same shape as the scanner: one handover is 2 requests (preview + confirm),
  // so the ceiling has to clear a fast-moving queue.
  const limiter = await rateLimit(ip, 300, 60000);
  if (!limiter.success) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, {
      status: 429,
      headers: { "Retry-After": Math.ceil((limiter.resetTime - Date.now()) / 1000).toString() },
    });
  }

  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!access.canAward) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const prize = await db.query.prizes.findFirst({
      where: eq(prizes.id, id),
      columns: { id: true, eventId: true, eligibilityEventId: true },
    });
    if (!prize) return NextResponse.json({ error: "Prize not found" }, { status: 404 });
    if (!(await canReachPrize(access, prize))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = schema.parse(await req.json());

    if (body.action === "preview") {
      // Preview is QR-only: the manual picker already knows the user id and goes
      // straight to confirm, so there is nothing to resolve here.
      if (!body.qrToken) {
        return NextResponse.json({ error: "qrToken is required to preview" }, { status: 400 });
      }
      const result = await PrizeService.previewClaim({ prizeId: id, qrToken: body.qrToken, ipAddress: ip });
      return NextResponse.json(result);
    }

    const result = await PrizeService.claim({
      prizeId: id,
      qrToken: body.qrToken,
      studentUserId: body.studentUserId,
      eventId: body.eventId ?? null,
      note: body.note ?? null,
      actorId: access.userId,
      ipAddress: ip,
    });

    // "already_claimed" is an expected, non-exceptional outcome at a booth —
    // 409 so the client can render the refusal without treating it as an error.
    return NextResponse.json(result, { status: result.status === "already_claimed" ? 409 : 200 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/prizes/[id]/claim" });
    return NextResponse.json({ status: "error", error: "Failed to record the claim" }, { status: 500 });
  }
}
