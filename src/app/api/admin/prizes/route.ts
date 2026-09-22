import { db } from "@/db";
import { prizes } from "@/db/schema";
import { PrizeService } from "@/modules/events/prize.service";
import { AuditService } from "@/modules/audit/audit.service";
import { getClientIp } from "@/lib/rate-limit";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET  /api/admin/prizes — the prize list with claim + รอรูป counts.
// POST /api/admin/prizes — create a prize.
//
// A prize is NOT owned by an event (docs/features/prize-claim.md), so this is a
// top-level collection rather than a sub-resource of /api/admin/events/[id].

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  eventId: z.string().uuid().nullish(),
  rank: z.number().int().min(1).max(999).nullish(),
  quantity: z.number().int().min(0).max(100000).nullish(),
  onePerStudent: z.boolean().default(true),
  requireCheckIn: z.boolean().default(false),
  eligibilityEventId: z.string().uuid().nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export async function GET() {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const all = await PrizeService.listPrizes();

    // Award-only roles (smo) still need the list to pick a prize at the booth,
    // and get BOTH counts: claimCount ("how many have gone out") and
    // awaitingPhotoCount ("how much of the booth's own work is unfinished") are
    // both operational numbers with no student's name in them. The line that
    // actually separates the tiers is NAMES, not numbers — the winner ROLL
    // (GET /api/admin/prizes/[id]) stays canManage, and the dean report stays
    // canExport. An smo is also unscoped for prizes (see prize-scope.ts), so
    // this branch skips the per-prize canReachPrize filter below on purpose.
    if (!access.canManage) {
      return NextResponse.json({
        prizes: all,
        canManage: false,
        canExport: false,
        canAward: access.canAward,
      });
    }

    const reachable = [];
    for (const p of all) {
      if (await canReachPrize(access, p)) reachable.push(p);
    }
    return NextResponse.json({ prizes: reachable, canManage: true, canExport: access.canExport });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/prizes" });
    return NextResponse.json({ error: "Failed to load prizes" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Creating/configuring is deliberately NOT an award-role capability: smo may
    // hand prizes out but may not invent one.
    if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = createSchema.parse(await req.json());

    // A scoped president may only create a prize under an event they own — the
    // same check the prize will later be read through, applied at creation so
    // they can't create something they immediately can't see.
    if (!(await canReachPrize(access, { eventId: body.eventId ?? null, eligibilityEventId: body.eligibilityEventId ?? null }))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [row] = await db
      .insert(prizes)
      .values({
        name: body.name,
        description: body.description ?? null,
        eventId: body.eventId ?? null,
        rank: body.rank ?? null,
        quantity: body.quantity ?? null,
        onePerStudent: body.onePerStudent,
        requireCheckIn: body.requireCheckIn,
        eligibilityEventId: body.eligibilityEventId ?? null,
        sortOrder: body.sortOrder,
        createdBy: access.userId,
      })
      .returning({ id: prizes.id });

    await AuditService.logAction({
      actorId: access.userId,
      action: `Created prize "${body.name}" (${row.id}, onePerStudent=${body.onePerStudent}, requireCheckIn=${body.requireCheckIn})`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/prizes" });
    return NextResponse.json({ error: "Failed to create prize" }, { status: 500 });
  }
}
