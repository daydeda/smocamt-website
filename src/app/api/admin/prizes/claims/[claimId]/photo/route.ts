import { auth } from "@/auth";
import { db } from "@/db";
import { prizeClaims, prizes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PrizeService } from "@/modules/events/prize.service";
import { AuditService } from "@/modules/audit/audit.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { downloadFormFile, deleteFormFile } from "@/lib/form-file-storage";
import { getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";
// Streams a stored object — Node runtime, not edge.
export const runtime = "nodejs";

// The proof photo for one prize claim: a picture of an identifiable student's
// face, collected specifically to be disclosed to a third party (คณบดี).
//
// Modelled line for line on api/attendance/evidence/[attendanceId]: it lives in
// the same PRIVATE "form-uploads" bucket, is never a public URL, is reachable
// only by the student themself or scoped staff, and every third-party view
// writes an audit log. The audit trail is the accountability mechanism for this
// data — see docs/features/prize-claim.md.

// A stored key is always "<uuid>.<ext>" (uploadFormFile, src/lib/form-file-storage.ts).
const KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadClaim(claimId: string) {
  return await db
    .select({
      id: prizeClaims.id,
      studentId: prizeClaims.studentId,
      photoKey: prizeClaims.photoKey,
      prizeName: prizeClaims.prizeName,
      prizeEventId: prizes.eventId,
      prizeEligibilityEventId: prizes.eligibilityEventId,
    })
    .from(prizeClaims)
    .innerJoin(prizes, eq(prizes.id, prizeClaims.prizeId))
    .where(eq(prizeClaims.id, claimId))
    .limit(1)
    .then((r) => r[0] ?? null);
}

// GET — stream the photo.
export async function GET(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { claimId } = await params;
    if (!UUID_PATTERN.test(claimId)) {
      return NextResponse.json({ error: "Invalid claim id" }, { status: 400 });
    }

    const claim = await loadClaim(claimId);
    if (!claim?.photoKey || !KEY_PATTERN.test(claim.photoKey)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // The student may always see their own photo — they are in it.
    const isOwner = claim.studentId === session.user.id;
    let isStaff = false;
    if (!isOwner) {
      const access = await resolvePrizeAccess();
      isStaff = !!access && await canReachPrize(access, {
        eventId: claim.prizeEventId,
        eligibilityEventId: claim.prizeEligibilityEventId,
      });
      if (!isStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { buffer, contentType } = await downloadFormFile(claim.photoKey);

    // PDPA: a third party viewing a student's face leaves a trail. The owner
    // viewing their own photo is not logged. Best-effort — never block the view
    // on an audit hiccup.
    if (isStaff) {
      try {
        await AuditService.logAction({
          actorId: session.user.id!,
          targetId: claim.studentId,
          action: `Viewed prize proof photo (claim ${claimId}, prize "${claim.prizeName}")`,
          ipAddress: getClientIp(req),
        });
      } catch (e) {
        console.error("Failed to audit prize-photo view:", e);
      }
    }

    const ext = claim.photoKey.slice(claim.photoKey.lastIndexOf("."));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${claimId}${ext}"`,
        // Never cached by a shared cache — this is personal data behind an auth gate.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/prizes/claims/[claimId]/photo" });
    return NextResponse.json({ error: "Failed to load photo" }, { status: 500 });
  }
}

const attachSchema = z.object({ photoKey: z.string().regex(KEY_PATTERN) });

// POST — attach (or replace) the photo, after it has been uploaded via
// /api/forms/upload into the same private bucket.
export async function POST(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Whoever may award may also complete the record — chasing a รอรูป claim is
    // the same job as taking the photo at the booth.
    if (!access.canAward) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { claimId } = await params;
    if (!UUID_PATTERN.test(claimId)) {
      return NextResponse.json({ error: "Invalid claim id" }, { status: 400 });
    }

    const claim = await loadClaim(claimId);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canReachPrize(access, { eventId: claim.prizeEventId, eligibilityEventId: claim.prizeEligibilityEventId }))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { photoKey } = attachSchema.parse(await req.json());
    const previousKey = claim.photoKey;

    const updated = await PrizeService.attachPhoto({
      claimId,
      photoKey,
      actorId: access.userId,
      ipAddress: getClientIp(req),
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Replacing a photo orphans the old object in the private bucket. Delete it
    // rather than leaving a student's face behind with nothing pointing at it —
    // an unreferenced object is one nobody will ever think to remove.
    if (previousKey && previousKey !== photoKey) {
      try {
        await deleteFormFile(previousKey);
      } catch (e) {
        console.error("Failed to delete replaced prize photo:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/prizes/claims/[claimId]/photo" });
    return NextResponse.json({ error: "Failed to attach photo" }, { status: 500 });
  }
}

// DELETE — super_admin only. Retention is indefinite by product decision; this
// is the ONLY way a photo goes away.
//
// It deletes the PHOTO and keeps the CLAIM ROW: dropping the row would make the
// duplicate check forget the student, and they could collect a second one.
export async function DELETE(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!access.isSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { claimId } = await params;
    if (!UUID_PATTERN.test(claimId)) {
      return NextResponse.json({ error: "Invalid claim id" }, { status: 400 });
    }

    const cleared = await PrizeService.clearPhoto({
      claimId,
      actorId: access.userId,
      ipAddress: getClientIp(req),
    });
    if (!cleared) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Drop the object only after the row no longer references it, so a failure
    // here leaves an orphaned file rather than a row pointing at a missing one.
    try {
      await deleteFormFile(cleared.photoKey);
    } catch (e) {
      console.error("Failed to delete prize photo object:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    captureException(e, { route: "DELETE /api/admin/prizes/claims/[claimId]/photo" });
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 });
  }
}
