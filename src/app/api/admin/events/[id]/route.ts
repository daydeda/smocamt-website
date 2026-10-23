import { auth } from "@/auth";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/modules/audit/audit.service";
import { allowedEventYearsSchema, sessionInputSchema, sessionsHaveInvalidSpan } from "@/lib/events/event-schema";
import { canEditEventDirectly, effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { syncEventToSongsue } from "@/lib/integrations/songsue-sync";
import { eventYearFields } from "@/lib/access/event-access";
import { AdminEventsService } from "@/modules/events/admin-events.service";
import { EventsService } from "@/modules/events/events.service";
import { announceNewEventIfOpen } from "@/modules/notifications/new-event.service";

const eventUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  registrationOpenTime: z.string().datetime().optional().nullable(),
  registrationCloseTime: z.string().datetime().optional().nullable(),
  quota: z.number().int().min(0).optional().nullable(),
  location: z.string().optional().nullable(),
  pointsAwarded: z.number().int().min(0).max(10000).optional().nullable(),
  individualPointsAwarded: z.number().int().min(0).max(10000).optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  imageUrls: z.array(z.string()).optional().nullable(),
  walkInsEnabled: z.boolean().optional(),
  // Walk-ins-only: no pre-registration is accepted at all (see the register
  // route). Implies walkInsEnabled — enforced below, not just trusted from the client.
  walkInsOnly: z.boolean().optional(),
  quotaWalkIn: z.number().int().min(0).optional().nullable(),
  registrationMode: z.enum(["once", "per_session"]).optional(),
  // 'qr' (default) = scanner/manual/walk-in check-in. 'evidence' = students
  // self-submit proof instead — see events.checkInMode in schema.ts.
  checkInMode: z.enum(["qr", "evidence"]).optional(),
  // Two-step QR check-in/check-out — see events.requireCheckOut in schema.ts.
  requireCheckOut: z.boolean().optional(),
  // Sub-option of requireCheckOut — see events.checkOutEvidenceRequired in schema.ts.
  checkOutEvidenceRequired: z.boolean().optional(),
  // When provided, the full desired set of sessions. Existing sessions are
  // matched by id (updated), new ones inserted, dropped ones removed — except a
  // session that already has attendance is never deleted (non-destructive).
  sessions: z.array(sessionInputSchema).optional(),
  targetThai: z.boolean().optional(),
  targetInternational: z.boolean().optional(),
  quotaThai: z.number().int().min(0).optional().nullable(),
  quotaInternational: z.number().int().min(0).optional().nullable(),
  allowedRoles: z.array(z.string()).optional().nullable(),
  allowedMajors: z.array(z.string()).optional().nullable(),
  // Club-based participant eligibility (SEPARATE from ownerClubIds below, which
  // controls who MANAGES the event) — see events.allowedClubs in schema.ts.
  allowedClubs: z.array(z.string().uuid()).optional().nullable(),
  allowedYears: allowedEventYearsSchema.optional().nullable(),
  // Compatibility for older clients and proposals.
  firstYearOnly: z.boolean().optional(),
  // Which president role(s) MANAGE this event — separate from allowedRoles.
  managedByRoles: z.array(z.string()).optional().nullable(),
  // WHICH club(s)/major(s) own this event — see EventScopeService.
  ownerClubIds: z.array(z.string().uuid()).optional().nullable(),
  ownerMajors: z.array(z.string()).optional().nullable(),
  // Specific user IDs assigned as staff for THIS event — see events.staffUserIds
  // in schema.ts. Staff-only, like managedByRoles below.
  staffUserIds: z.array(z.string()).optional().nullable(),
  // "Also count for Songsue" — staff-only, like staffUserIds above. See
  // events.songsueLinked in schema.ts.
  songsueLinked: z.boolean().optional(),
  // Staff-only approve/reopen toggle — see events.detailsReviewStatus in
  // schema.ts. Never reaches a live column for a president actor (see
  // PRESIDENT_EDITABLE_FIELDS below) — a president's PUT always forces
  // pending regardless of this field.
  detailsReviewStatus: z.enum(["pending", "approved"]).optional(),
  // Staff-only: drop a pending president edit without applying it — live
  // fields stay exactly as they are. See events.pendingDetailsChanges.
  discardPendingDetails: z.boolean().optional(),
}).refine(
  // Only enforce when BOTH ends are supplied — this is a partial update.
  (d) => {
    if (!d.startTime || !d.endTime) return true;
    return new Date(d.endTime) > new Date(d.startTime);
  },
  { message: "endTime must be after startTime", path: ["endTime"] },
).refine(
  (d) => !d.sessions || !sessionsHaveInvalidSpan(d.sessions),
  {
    // Only fires with an EXPLICIT per-day schedule (2+ session rows) where one
    // row itself spans multiple days — a single session may legitimately span
    // several days on purpose. See sessionsHaveInvalidSpan.
    message: "Each day in a per-day schedule must start and end on the same calendar day — add each additional day as its own session instead of stretching one across several dates",
    path: ["endTime"],
  },
).refine(
  // Only enforced when BOTH are explicitly present in this request (the
  // normal case: the editor sends checkInMode and its sessions together) —
  // a partial update that touches neither, or only one, is left alone rather
  // than chasing whatever the live/pending state already has.
  (d) => d.checkInMode !== "evidence" || !d.sessions || d.sessions.every((s) => !!s.evidenceNonce),
  {
    message: "Every session needs a code word (evidenceNonce) when check-in mode is 'evidence'.",
    path: ["sessions"],
  },
);

// PUT /api/admin/events/[id] — Update event
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
    // A club/major-scoped registration position (case 2/3) is deliberately NOT
    // extended to event edits here — editing runs through a president-only
    // pending-review/allowlist flow below that would need its own design work
    // to safely extend; only a GLOBAL registration position (case 1) gets full
    // edit parity with the "registration" role.
    const isAdminRole = canEditEventDirectly(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));
    if (!session?.user || (!isAdminRole && !isPresidentRole)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = eventUpdateSchema.parse(body);
    const data = { ...parsed, ...eventYearFields(parsed) };

    // Posters normalization from the submitted payload — used both for a
    // direct staff edit and for a president's stored diff, so it only needs
    // to happen once regardless of which branch below actually uses it.
    let posters: string[] | undefined;
    if (data.imageUrls !== undefined) {
      posters = (data.imageUrls ?? [])
        .filter((u): u is string => typeof u === "string" && u.trim() !== "");
    }
    const coverFromPosters = posters !== undefined ? (posters[0] ?? null) : undefined;

    const ip = getClientIp(req);

    // Set true ONLY in the branch below that actually writes the events table's
    // LIVE columns (not the president pending-diff branch, and not the discard
    // branch, which never touches title/schedule/points/etc.) — gates the
    // Songsue mirror call after the transaction commits, so a president's
    // held-for-review edit or a no-op discard never fires a sync of stale data.
    let liveColumnsChanged = false;

    let updated: Awaited<ReturnType<typeof AdminEventsService.updateEvent>>["updated"];
    try {
      const result = await AdminEventsService.updateEvent({
        id,
        data,
        posters,
        coverFromPosters,
        isAdminRole,
        myRoles,
        actorId: session.user!.id!,
        ipAddress: ip,
      });
      updated = result.updated;
      liveColumnsChanged = result.liveColumnsChanged;
    } catch (e) {
      if (e instanceof Error && e.message === "EVENT_NOT_FOUND") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      if (e instanceof Error && e.message === "UNAUTHORIZED_SCOPE") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (e instanceof Error && e.message === "NO_SESSIONS_LEFT") {
        return NextResponse.json({ error: "An event must have at least one session" }, { status: 400 });
      }
      throw e;
    }

    // Best-effort mirror into Songsue — never blocks this save (see songsue-sync.ts).
    // Only fires when this request actually wrote the live columns (not a
    // president's held-for-review diff, not a bare discard).
    if (liveColumnsChanged && updated.songsueLinked) {
      const staff = updated.staffUserIds && updated.staffUserIds.length > 0
        ? await EventsService.listStaffContacts(updated.staffUserIds)
        : [];
      await syncEventToSongsue({
        externalId: updated.id,
        title: updated.title,
        description: updated.description,
        startTime: updated.startTime.toISOString(),
        endTime: updated.endTime.toISOString(),
        location: updated.location,
        pointsAwarded: updated.pointsAwarded,
        individualPointsAwarded: updated.individualPointsAwarded,
        walkInsEnabled: updated.walkInsEnabled,
        quota: updated.quota,
        quotaWalkIn: updated.quotaWalkIn,
        imageUrl: updated.imageUrl,
        imageUrls: updated.imageUrls,
        staff,
      });
    }

    // An event hidden from students (e.g. SMO-only) that this edit opened up gets its
    // one-time "new event" push. No-op when already announced or still hidden.
    if (liveColumnsChanged) {
      after(() => announceNewEventIfOpen(updated.id));
    }

    return NextResponse.json({ success: true, event: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", ")
      }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/admin/events/[id] — Delete event (soft: archives attendance)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const isAdminRole = ["super_admin", "admin", "registration", "organizer"].includes(session?.user?.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session?.user?.role, session?.user?.roles), session?.user?.smoPosition, session?.user?.anusmoPosition);
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await AdminEventsService.deleteEvent(id, session.user!.id!, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error(error);
    if (error instanceof Error && error.message === "Event not found") {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
