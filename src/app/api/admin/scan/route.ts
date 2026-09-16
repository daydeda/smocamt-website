import { auth } from "@/auth";
import { canEnterAdminAny, canGiveIndividualScoreAny, effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";
import { ScannerService } from "@/modules/events/scanner.service";
import { EventsService } from "@/modules/events/events.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { db } from "@/db";
import { events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/logger";
import { revalidateLeaderboards } from "@/lib/leaderboard-cache";

// Fail fast instead of hanging to the 300s platform default if the DB pooler stalls.
// Scanning must stay responsive during the event even under load.
export const maxDuration = 20;

// A stored evidence key is always "<uuid>.<ext>" — see uploadFormFile in
// src/lib/form-file-storage.ts (reused as-is for the check-out photo).
const EVIDENCE_KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

const scanSchema = z.object({
  qrToken: z.string(), // Allows fallback IDs as well
  eventId: z.string().uuid(),
  // Which session (day) the check-in counts for. Optional so legacy clients still
  // work — when omitted the server resolves the "current" session for the event.
  sessionId: z.string().uuid().optional(),
  action: z.enum(["scan", "confirm", "confirm_checkout", "score", "lookup"]).default("scan"),
  medsCheckOption: z.string().nullish(),
  // Allow negatives so admins can deduct points (penalties/corrections); 0 is meaningless.
  score: z.number().int().gte(-500).lte(500).refine((n) => n !== 0, "Score cannot be zero").optional(),
  reason: z.string().optional(),
  // Only for action "confirm_checkout" (events.requireCheckOut) — the kept
  // proof photo's storage key, uploaded beforehand via /api/forms/upload.
  evidenceFileKey: z.string().regex(EVIDENCE_KEY_PATTERN).optional(),
});

export async function POST(req: Request) {
  // Apply IP Rate Limiter. This is an admin-authenticated endpoint on the scanning
  // hot path: a single check-in is 2 requests (scan + confirm), so the limit must be
  // high enough for rapid mass check-in. 300/min ≈ 5 req/s comfortably covers it.
  const ip = getClientIp(req);
  const limiter = await rateLimit(ip, 300, 60000);
  if (!limiter.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { 
        status: 429,
        headers: {
          "Retry-After": Math.ceil((limiter.resetTime - Date.now()) / 1000).toString(),
        }
      }
    );
  }

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Gate on the whole role SET, not just the primary role — a president whose
    // primary role resolves to a non-entry role (e.g. anusmo) must still be able to
    // scan. canEnterAdminAny matches the admin-entry roles (incl. scanner-only).
    const roles = effectiveRoles(session.user.role, session.user.roles);
    const smoPosition = session.user.smoPosition;
    const anusmoPosition = session.user.anusmoPosition;
    if (!canEnterAdminAny(roles, session.user.hasStaffPosition)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { qrToken, eventId, sessionId, action, medsCheckOption, score, reason, evidenceFileKey } = scanSchema.parse(body);

    // President roles, and a club/major-scoped registration position, may only
    // scan events they OWN (ownerClubIds/ownerMajors), mirroring the
    // /api/admin/events list + attendance/report scoping. Staff, smo, and a
    // GLOBAL registration position (smo/anusmo + position="registration") are
    // unscoped — scoping the club/major case is deliberately STRICTER than the
    // old flat "registration" role would have been (every club's every event),
    // not looser, so this is safe to enable without a bake-in period like the
    // rest of this rollout.
    const isStaff = roles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r))
      || isGlobalRegistrationPosition(roles, smoPosition, anusmoPosition);
    const presidentTags = roles.filter((r) => ["club_president", "major_president"].includes(r));
    const hasRegistrationScope = !isStaff && presidentTags.length === 0
      && (await EventScopeService.hasRegistrationScope(session.user.id!, roles, smoPosition, anusmoPosition));
    if (!isStaff && (presidentTags.length > 0 || hasRegistrationScope)) {
      const ev = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { ownerClubIds: true, ownerMajors: true },
      });
      const access = await EventScopeService.resolveEventAccess({
        userId: session.user.id!, roles, smoPosition, anusmoPosition, isUnscopedStaff: false, hasPresidentTag: presidentTags.length > 0,
      });
      const managed = access.allowed && (access.unscoped || (ev ? EventScopeService.isEventManagedByScope(ev, access.scope) : false));
      if (!managed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // When the client doesn't pin a session, record the check-in against the
    // event's "current" day (window containing now → upcoming → most recent).
    const resolvedSessionId = sessionId ?? (await EventsService.resolveCurrentSessionId(eventId));
    if (!resolvedSessionId) {
      return NextResponse.json(
        { status: "not_found", error: "Event has no sessions configured." },
        { status: 404 }
      );
    }

    // Individual scoring is NOT part of the scanner-only president roles: they may
    // check in attendees but must not award/deduct individual points. smo keeps it.
    // The "lookup" action (score-mode student resolve) is a read-only prelude to a
    // score, so block it here too — otherwise these roles could still use score UI.
    if ((action === "score" || action === "lookup") && !canGiveIndividualScoreAny(roles)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delegate business operation to ScannerService
    const result = await ScannerService.processScan({
      qrToken,
      eventId,
      sessionId: resolvedSessionId,
      action,
      medsCheckOption,
      score,
      reason,
      evidenceFileKey,
      actorId: session.user.id!,
      actorRole: session.user.role || "",
      ipAddress: ip,
    });

    // Map service domain statuses to HTTP status codes
    if (result.status === "not_found") {
      return NextResponse.json(
        { status: result.status, error: result.error },
        { status: 404 }
      );
    }

    if (result.status === "already_checked_in") {
      return NextResponse.json(
        {
          status: result.status,
          student: result.student,
          checkedInAt: result.checkedInAt,
        },
        { status: 409 }
      );
    }

    if (result.status === "quota_full") {
      return NextResponse.json(
        { status: result.status, error: result.error },
        { status: 422 }
      );
    }

    if (result.status === "not_registered") {
      return NextResponse.json(
        {
          status: result.status,
          student: result.student,
          error: result.error,
        },
        { status: 422 }
      );
    }

    if (result.status === "walk_ins_disabled") {
      return NextResponse.json(
        {
          status: result.status,
          student: result.student,
          error: result.error,
        },
        { status: 403 }
      );
    }

    // "success"/"success_walk_in" cover both a confirmed check-in (which may award
    // per-attendee points) and the "score" action — bust the cached leaderboard so
    // it reflects the change on the next poll instead of waiting out the cache TTL.
    // "pending_confirmation" hasn't mutated anything yet, so it's excluded.
    if (result.status === "success" || result.status === "success_walk_in") {
      revalidateLeaderboards();
    }

    // Success outcomes (success, success_walk_in, pending_confirmation)
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") 
        },
        { status: 400 }
      );
    }
    captureException(error, { route: "POST /api/admin/scan" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Manual search fires per keystroke; allow a higher ceiling than the default.
  const ip = getClientIp(req);
  const limiter = await rateLimit(ip, 120, 60000);
  if (!limiter.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { 
        status: 429,
        headers: {
          "Retry-After": Math.ceil((limiter.resetTime - Date.now()) / 1000).toString(),
        }
      }
    );
  }

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Gate on the whole role SET, not just the primary role — a president whose
    // primary role resolves to a non-entry role (e.g. anusmo) must still be able to
    // scan. canEnterAdminAny matches the admin-entry roles (incl. scanner-only).
    const roles = effectiveRoles(session.user.role, session.user.roles);
    if (!canEnterAdminAny(roles, session.user.hasStaffPosition)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query || query.length < 2) {
      return NextResponse.json({ error: "Search query too short" }, { status: 400 });
    }

    // Delegate query search to ScannerService
    const results = await ScannerService.searchStudents(query);
    return NextResponse.json(results);
  } catch (error) {
    captureException(error, { route: "GET /api/admin/scan" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
