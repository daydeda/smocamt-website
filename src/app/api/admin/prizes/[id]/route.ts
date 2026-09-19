import { db } from "@/db";
import { prizes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PrizeService } from "@/modules/events/prize.service";
import { AuditService } from "@/modules/audit/audit.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { getClientIp } from "@/lib/rate-limit";
import { deleteFormFile } from "@/lib/form-file-storage";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET    /api/admin/prizes/[id] — prize + its claim list (management view).
// PATCH  /api/admin/prizes/[id] — edit / close a prize.
// DELETE /api/admin/prizes/[id] — super_admin only.

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  eventId: z.string().uuid().nullish(),
  rank: z.number().int().min(1).max(999).nullish(),
  quantity: z.number().int().min(0).max(100000).nullish(),
  onePerStudent: z.boolean().optional(),
  requireCheckIn: z.boolean().optional(),
  eligibilityEventId: z.string().uuid().nullish(),
  status: z.enum(["open", "closed"]).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

// Guards every id before it reaches a query. A missing/malformed id passed
// straight to eq(prizes.id, id) is sent to Postgres as a bound parameter,
// which fails as an opaque driver-level error instead of a clean 400.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The claim list is every winner's name + รหัสนักศึกษา for this prize; an
    // award-only role (smo) sees one student at a time at the booth, not the roll.
    if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid prize id" }, { status: 400 });
    }
    const data = await PrizeService.getClaimsForReport(id);
    if (!data) return NextResponse.json({ error: "Prize not found" }, { status: 404 });
    if (!(await canReachPrize(access, data.prize))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      prize: data.prize,
      contextEvent: data.contextEvent,
      // photoKey is the private object key — the client must never see it, it
      // fetches photos through the auth-guarded claim-photo route by claim id.
      claims: data.rows.map(({ photoKey, ...rest }) => ({ ...rest, hasPhoto: !!photoKey })),
      canExport: access.canExport,
      isSuperAdmin: access.isSuperAdmin,
    });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/prizes/[id]" });
    return NextResponse.json({ error: "Failed to load prize" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid prize id" }, { status: 400 });
    }
    const existing = await db.query.prizes.findFirst({ where: eq(prizes.id, id) });
    if (!existing) return NextResponse.json({ error: "Prize not found" }, { status: 404 });
    if (!(await canReachPrize(access, existing))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = patchSchema.parse(await req.json());

    // Moving a prize between events could move it OUT of the editor's own
    // scope; check the destination too, or a president could hand a prize off
    // to a club they don't preside over and lose the ability to fix it.
    if (body.eventId !== undefined || body.eligibilityEventId !== undefined) {
      const next = {
        eventId: body.eventId !== undefined ? body.eventId ?? null : existing.eventId,
        eligibilityEventId: body.eligibilityEventId !== undefined ? body.eligibilityEventId ?? null : existing.eligibilityEventId,
      };
      if (!(await canReachPrize(access, next))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    await db.update(prizes).set({ ...body, updatedAt: new Date() }).where(eq(prizes.id, id));

    // onePerStudent is deliberately called out in the log line: flipping it off
    // is what lets a student claim twice, and existing claim rows keep their own
    // copied flag (the partial unique index reads the CLAIM's column, not this
    // one), so old claims stay protected while new ones do not.
    await AuditService.logAction({
      actorId: access.userId,
      action: `Updated prize "${existing.name}" (${id}): ${Object.keys(body).join(", ") || "no fields"}`
        + (body.onePerStudent === false ? " — onePerStudent DISABLED" : ""),
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    captureException(e, { route: "PATCH /api/admin/prizes/[id]" });
    return NextResponse.json({ error: "Failed to update prize" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Deleting a prize CASCADES its claims — the record that 200 students
    // received แก้ว. super_admin only, and the UI should be pushing "close"
    // instead for anything that has ever been claimed.
    if (!access.isSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid prize id" }, { status: 400 });
    }
    const existing = await db.query.prizes.findFirst({ where: eq(prizes.id, id) });
    if (!existing) return NextResponse.json({ error: "Prize not found" }, { status: 404 });

    const claims = await PrizeService.getClaimsForReport(id);
    const claimCount = claims?.rows.length ?? 0;
    // Read the keys BEFORE the cascade removes the rows that point at them,
    // otherwise every proof photo is orphaned in the private bucket with
    // nothing left referencing it — i.e. students' faces nobody will ever think
    // to clean up.
    const orphanedPhotoKeys = (claims?.rows ?? []).map((r) => r.photoKey).filter((k): k is string => !!k);

    await db.delete(prizes).where(eq(prizes.id, id));

    for (const key of orphanedPhotoKeys) {
      try {
        await deleteFormFile(key);
      } catch (e) {
        console.error(`Failed to delete orphaned prize photo ${key}:`, e);
      }
    }

    await AuditService.logAction({
      actorId: access.userId,
      action: `Deleted prize "${existing.name}" (${id}) — ${claimCount} claim(s) cascaded, ${orphanedPhotoKeys.length} photo(s) removed`,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ ok: true, deletedClaims: claimCount });
  } catch (e) {
    captureException(e, { route: "DELETE /api/admin/prizes/[id]" });
    return NextResponse.json({ error: "Failed to delete prize" }, { status: 500 });
  }
}
