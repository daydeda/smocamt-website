import { auth } from "@/auth";
import { db } from "@/db";
import { events, eventSessions, attendance, users } from "@/db/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { sessionInputSchema, sessionsHaveInvalidSpan } from "@/lib/event-schema";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/admin-access";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { syncEventToSongsue } from "@/lib/songsue-sync";

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
  // Restrict the event to the current first-year intake (id-prefix derived).
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
);

type EventUpdateData = z.infer<typeof eventUpdateSchema>;

// Fields a club/major president may propose changes to on an EXISTING event —
// title/schedule/quota/etc. Role/access/points/staff fields are deliberately
// excluded (those stay staff-only, see the admin-only branch in PUT below).
// This single list drives three things that must never drift apart: what a
// president's diff is allowed to contain, the "did anything actually change"
// check, and what gets applied to live columns when staff approve it.
const PRESIDENT_EDITABLE_FIELDS = [
  "title", "description", "startTime", "endTime", "registrationOpenTime",
  "registrationCloseTime", "quota", "location", "imageUrl", "imageUrls",
  "walkInsEnabled", "walkInsOnly", "quotaWalkIn", "registrationMode",
  "sessions", "targetThai", "targetInternational", "quotaThai",
  "quotaInternational", "firstYearOnly",
] as const;
type PresidentEditableField = (typeof PRESIDENT_EDITABLE_FIELDS)[number];
type PendingDetailsPayload = Partial<Pick<EventUpdateData, PresidentEditableField>>;

function pickEditableFields(data: EventUpdateData): PendingDetailsPayload {
  const picked: PendingDetailsPayload = {};
  for (const field of PRESIDENT_EDITABLE_FIELDS) {
    const value = data[field];
    if (value !== undefined) {
      (picked as Record<string, unknown>)[field] = value;
    }
  }
  return picked;
}

// Builds the events-table SET clause shared by (a) a direct staff edit and
// (b) applying an approved pending president diff (see PUT below) — kept in
// one place so those two paths can never disagree on how a field is written.
function buildEventSetFields(
  data: EventUpdateData,
  posters: string[] | undefined,
  coverFromPosters: string | null | undefined
) {
  return {
    ...(data.title && { title: data.title }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.startTime && { startTime: new Date(data.startTime) }),
    ...(data.endTime && { endTime: new Date(data.endTime) }),
    ...(data.registrationOpenTime !== undefined && {
        registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null
    }),
    ...(data.registrationCloseTime !== undefined && {
        registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null
    }),
    ...(data.quota !== undefined && { quota: data.quota }),
    ...(data.location !== undefined && { location: data.location }),
    ...(data.pointsAwarded !== undefined && { pointsAwarded: data.pointsAwarded }),
    ...(data.individualPointsAwarded !== undefined && { individualPointsAwarded: data.individualPointsAwarded }),
    ...(posters !== undefined
      ? { imageUrls: posters, imageUrl: coverFromPosters }
      : (data.imageUrl !== undefined && { imageUrl: data.imageUrl })),
    // walkInsOnly implies walkInsEnabled regardless of what the client sent.
    ...(data.walkInsOnly !== undefined && { walkInsOnly: data.walkInsOnly }),
    ...(data.walkInsOnly
      ? { walkInsEnabled: true }
      : (data.walkInsEnabled !== undefined && { walkInsEnabled: data.walkInsEnabled })),
    ...(data.quotaWalkIn !== undefined && { quotaWalkIn: data.quotaWalkIn }),
    ...(data.registrationMode !== undefined && { registrationMode: data.registrationMode }),
    ...(data.targetThai !== undefined && { targetThai: data.targetThai }),
    ...(data.targetInternational !== undefined && { targetInternational: data.targetInternational }),
    ...(data.quotaThai !== undefined && { quotaThai: data.quotaThai }),
    ...(data.quotaInternational !== undefined && { quotaInternational: data.quotaInternational }),
    ...(data.allowedRoles !== undefined && {
      allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null
    }),
    ...(data.allowedMajors !== undefined && {
      allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null
    }),
    ...(data.allowedClubs !== undefined && {
      allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null
    }),
    ...(data.firstYearOnly !== undefined && { firstYearOnly: data.firstYearOnly }),
    ...(data.managedByRoles !== undefined && {
      managedByRoles: data.managedByRoles && data.managedByRoles.length > 0 ? data.managedByRoles : null
    }),
    ...(data.ownerClubIds !== undefined && {
      ownerClubIds: data.ownerClubIds && data.ownerClubIds.length > 0 ? data.ownerClubIds : null
    }),
    ...(data.ownerMajors !== undefined && {
      ownerMajors: data.ownerMajors && data.ownerMajors.length > 0 ? data.ownerMajors : null
    }),
    ...(data.staffUserIds !== undefined && {
      staffUserIds: data.staffUserIds && data.staffUserIds.length > 0 ? data.staffUserIds : null
    }),
    ...(data.songsueLinked !== undefined && { songsueLinked: data.songsueLinked }),
  };
}

const DATE_FIELDS = new Set(["startTime", "endTime", "registrationOpenTime", "registrationCloseTime"]);

// No diff library in this repo (see the analogous manual string-diff builder
// in src/app/api/admin/users/[id]/route.ts) — a plain JSON-stringify compare
// is precise enough for the scalar/array fields here, with dates normalized
// to epoch millis first since a submitted ISO string and a fetched Date must
// compare equal when they represent the same instant.
function editableValueChanged(field: string, submitted: unknown, current: unknown): boolean {
  if (submitted === undefined) return false;
  if (DATE_FIELDS.has(field)) {
    const s = submitted == null ? null : new Date(submitted as string).getTime();
    const c = current == null ? null : new Date(current as string | Date).getTime();
    return s !== c;
  }
  return JSON.stringify(submitted ?? null) !== JSON.stringify(current ?? null);
}

function normalizeSessionForCompare(s: {
  title?: string | null;
  startTime: string | Date;
  endTime: string | Date;
  quotaWalkIn?: number | null;
}) {
  return {
    title: s.title?.trim() || null,
    startTime: new Date(s.startTime).toISOString(),
    endTime: new Date(s.endTime).toISOString(),
    quotaWalkIn: s.quotaWalkIn ?? null,
  };
}

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
    const isAdminRole = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer"].includes(r))
      || isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
    const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));
    if (!session?.user || (!isAdminRole && !isPresidentRole)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const data = eventUpdateSchema.parse(body);

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

    let updated: typeof events.$inferSelect;
    try {
      updated = await db.transaction(async (tx) => {
        const current = await tx.query.events.findFirst({ where: eq(events.id, id) });
        if (!current) {
          throw new Error("EVENT_NOT_FOUND");
        }

        // A club/major president may edit their OWN event's details (title,
        // description, schedule, location, quota, etc.) — but the edit is
        // held as a pending proposal (events.pendingDetailsChanges) instead
        // of ever touching the live columns; those are only written once
        // staff approve it below. Role/access/points/Managed By/staff stay
        // staff-only, enforced by PRESIDENT_EDITABLE_FIELDS being an
        // allowlist (pickEditableFields), not by stripping a denylist.
        if (!isAdminRole) {
          const scope = await EventScopeService.getPresidentScope(session.user.id!, myRoles);
          if (!EventScopeService.isEventManagedByScope(current, scope)) {
            throw new Error("UNAUTHORIZED_SCOPE");
          }

          const editablePayload = pickEditableFields(data);
          if (posters !== undefined) {
            editablePayload.imageUrls = posters;
            editablePayload.imageUrl = coverFromPosters;
          }

          // Compare against the MOST RECENT proposed state, not always the
          // live row — an already-outstanding pending edit (from an earlier,
          // still-unreviewed submission) is what the president is actually
          // looking at when they reopen the form (see handleEdit's draft
          // merge client-side), so resubmitting it unchanged must read as a
          // no-op too, not as a fresh change every time.
          const existingPending = (current.pendingDetailsChanges as PendingDetailsPayload | null) ?? {};
          const comparisonBase: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>), ...existingPending };

          let sessionsChanged = false;
          if (data.sessions !== undefined) {
            let baseSessions: { title: string | null; startTime: string | Date; endTime: string | Date; quotaWalkIn: number | null }[];
            if (existingPending.sessions !== undefined) {
              baseSessions = existingPending.sessions.map((s) => ({
                title: s.title ?? null,
                startTime: s.startTime,
                endTime: s.endTime,
                quotaWalkIn: s.quotaWalkIn ?? null,
              }));
            } else {
              baseSessions = await tx
                .select({
                  title: eventSessions.title,
                  startTime: eventSessions.startTime,
                  endTime: eventSessions.endTime,
                  quotaWalkIn: eventSessions.quotaWalkIn,
                })
                .from(eventSessions)
                .where(eq(eventSessions.eventId, id))
                .orderBy(eventSessions.sortOrder);
            }
            sessionsChanged = JSON.stringify(data.sessions.map(normalizeSessionForCompare))
              !== JSON.stringify(baseSessions.map(normalizeSessionForCompare));
          }

          const scalarChanged = PRESIDENT_EDITABLE_FIELDS.some((field) => {
            if (field === "sessions") return false;
            const submitted = (editablePayload as Record<string, unknown>)[field];
            return editableValueChanged(field, submitted, comparisonBase[field]);
          });

          if (!scalarChanged && !sessionsChanged) {
            // No-op save (president opened the editor and saved without
            // changing anything) — don't create a spurious pending-review
            // flag or touch any review-state column.
            return current;
          }

          const [row] = await tx
            .update(events)
            .set({
              pendingDetailsChanges: editablePayload,
              pendingDetailsSubmittedBy: session.user!.id!,
              pendingDetailsSubmittedAt: new Date(),
              detailsReviewStatus: "pending",
              // detailsReviewedBy/At deliberately left untouched — they
              // describe who approved the CURRENT LIVE content, which this
              // branch never modifies. A pending edit sitting on top doesn't
              // make the live content's last approval any less accurate.
              updatedAt: new Date(),
            })
            .where(eq(events.id, id))
            .returning();
          if (!row) throw new Error("EVENT_NOT_FOUND");

          await AuditService.logActionInternal(tx, {
            actorId: session.user!.id!,
            action: `Submitted pending changes for review: ${row.title}`,
            ipAddress: ip,
          });

          return row;
        }

        // Staff-only: drop a pending president edit without applying it —
        // live fields stay exactly as they are (they were never touched).
        if (data.discardPendingDetails) {
          const [row] = await tx
            .update(events)
            .set({
              pendingDetailsChanges: null,
              pendingDetailsSubmittedBy: null,
              pendingDetailsSubmittedAt: null,
              detailsReviewStatus: "approved",
              updatedAt: new Date(),
            })
            .where(eq(events.id, id))
            .returning();
          if (!row) throw new Error("EVENT_NOT_FOUND");

          await AuditService.logActionInternal(tx, {
            actorId: session.user!.id!,
            action: `Discarded pending changes: ${row.title}`,
            ipAddress: ip,
          });

          return row;
        }

        // Approving a pending president diff: apply its stored values to the
        // live columns via the same field-mapper a direct staff edit uses.
        // Anything the admin ALSO explicitly sent in this same request takes
        // precedence over the stored diff (in practice the UI only ever
        // sends the isolated { detailsReviewStatus: "approved" } call below).
        const approvingPending = data.detailsReviewStatus === "approved" && current.pendingDetailsChanges != null;
        // Trusted without re-validation: this JSON only ever holds a payload
        // that already passed eventUpdateSchema.parse() at submission time.
        const pendingAsData = approvingPending
          ? (current.pendingDetailsChanges as Partial<EventUpdateData>)
          : undefined;
        const effectiveData: EventUpdateData = pendingAsData ? { ...pendingAsData, ...data } : data;

        let effectivePosters = posters;
        let effectiveCover = coverFromPosters;
        if (pendingAsData && posters === undefined && pendingAsData.imageUrls !== undefined) {
          effectivePosters = (pendingAsData.imageUrls ?? [])
            .filter((u): u is string => typeof u === "string" && u.trim() !== "");
          effectiveCover = effectivePosters[0] ?? null;
        }

        const previousStaffUserIds = effectiveData.staffUserIds !== undefined
          ? (current.staffUserIds ?? [])
          : [];

        liveColumnsChanged = true;

        const [row] = await tx
          .update(events)
          .set({
            ...buildEventSetFields(effectiveData, effectivePosters, effectiveCover),
            // Staff-only approve/reopen toggle (never reached for president
            // actors) — approving sets the reviewer/timestamp; reopening
            // clears them, since they no longer describe the current state.
            ...(data.detailsReviewStatus !== undefined && {
              detailsReviewStatus: data.detailsReviewStatus,
              detailsReviewedBy: data.detailsReviewStatus === "approved" ? session.user!.id! : null,
              detailsReviewedAt: data.detailsReviewStatus === "approved" ? new Date() : null,
            }),
            ...(approvingPending && {
              pendingDetailsChanges: null,
              pendingDetailsSubmittedBy: null,
              pendingDetailsSubmittedAt: null,
            }),
            updatedAt: new Date(),
          })
          .where(eq(events.id, id))
          .returning();

        if (!row) {
          throw new Error("EVENT_NOT_FOUND");
        }

        // Keep attendance.isStaff in sync with staffUserIds both ways, so
        // assign/unassign is a clean, reversible action from the admin's
        // point of view (the Attendance roster's Staff/Students split and
        // the quota/no-show tallies all key off this per-row flag — see
        // schema.ts comment).
        if (effectiveData.staffUserIds !== undefined) {
          const newStaffIds = effectiveData.staffUserIds ?? [];
          // Newly assigned: someone who already had an attendance/registration
          // row for this event BEFORE being added to staffUserIds (e.g. they
          // self-registered as a regular attendee, then were assigned as staff
          // afterward). Without this, isStaff stays frozen at its register-time
          // snapshot and they'd never be exempted from quota/no-show strikes or
          // show up in the Attendance staff section.
          const newlyAddedStaffIds = newStaffIds.filter(
            (uid) => !previousStaffUserIds.includes(uid)
          );
          if (newlyAddedStaffIds.length > 0) {
            await tx
              .update(attendance)
              .set({ isStaff: true })
              .where(
                and(
                  eq(attendance.eventId, id),
                  inArray(attendance.studentId, newlyAddedStaffIds),
                  eq(attendance.isStaff, false)
                )
              );
          }
          // Newly removed: reverting isStaff back to false so unassigning
          // actually moves them back to Students and normal quota/no-show
          // counting, instead of leaving them permanently misclassified as
          // staff. This does mean their existing registration can retroactively
          // count against quota/no-show strikes once unassigned — that's the
          // intended, accurate behavior of undoing a staff assignment.
          const newlyRemovedStaffIds = previousStaffUserIds.filter(
            (uid) => !newStaffIds.includes(uid)
          );
          if (newlyRemovedStaffIds.length > 0) {
            await tx
              .update(attendance)
              .set({ isStaff: false })
              .where(
                and(
                  eq(attendance.eventId, id),
                  inArray(attendance.studentId, newlyRemovedStaffIds),
                  eq(attendance.isStaff, true)
                )
              );
          }
        }

        // Reconcile sessions when the editor sends them (either directly, or
        // via an approved pending diff). Match by id (update), insert new,
        // drop removed — but NEVER delete a session that already has
        // attendance (non-destructive). An event must always keep ≥1 session.
        if (effectiveData.sessions !== undefined) {
          const incoming = effectiveData.sessions;
          const existing = await tx
            .select({ id: eventSessions.id })
            .from(eventSessions)
            .where(eq(eventSessions.eventId, id));
          const existingIds = new Set(existing.map((s) => s.id));
          const incomingIds = new Set(incoming.filter((s) => s.id).map((s) => s.id!));

          for (let i = 0; i < incoming.length; i++) {
            const s = incoming[i];
            const fields = {
              title: s.title?.trim() ? s.title.trim() : null,
              startTime: new Date(s.startTime),
              endTime: new Date(s.endTime),
              sortOrder: i,
              quotaWalkIn: s.quotaWalkIn ?? null,
            };
            if (s.id && existingIds.has(s.id)) {
              await tx.update(eventSessions)
                .set({ ...fields, updatedAt: new Date() })
                .where(eq(eventSessions.id, s.id));
            } else {
              await tx.insert(eventSessions).values({ eventId: id, ...fields });
            }
          }

          const removedIds = [...existingIds].filter((eid) => !incomingIds.has(eid));
          if (removedIds.length > 0) {
            const withAttendance = await tx
              .select({ sessionId: attendance.sessionId })
              .from(attendance)
              .where(inArray(attendance.sessionId, removedIds))
              .groupBy(attendance.sessionId);
            const blocked = new Set(withAttendance.map((r) => r.sessionId));
            const deletable = removedIds.filter((rid) => !blocked.has(rid));
            if (deletable.length > 0) {
              await tx.delete(eventSessions).where(inArray(eventSessions.id, deletable));
            }
          }

          const [{ value: remaining }] = await tx
            .select({ value: count() })
            .from(eventSessions)
            .where(eq(eventSessions.eventId, id));
          if (remaining === 0) throw new Error("NO_SESSIONS_LEFT");
        }

        // Log the event update (through the service so the hash chain stays intact)
        await AuditService.logActionInternal(tx, {
          actorId: session.user!.id!,
          action: approvingPending
            ? `Approved pending changes: ${row.title}`
            : `Updated Event: ${row.title}`,
          ipAddress: ip,
        });

        return row;
      });
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
        ? await db.select({ email: users.email, name: users.name }).from(users).where(inArray(users.id, updated.staffUserIds))
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

    // Delete related records manually to avoid FK constraints if cascade isn't applied
    await db.transaction(async (tx) => {
      // 1. Attendance
      const { attendance, scoreHistory } = await import("@/db/schema");
      await tx.delete(attendance).where(eq(attendance.eventId, id));
      // 2. Score History
      await tx.delete(scoreHistory).where(eq(scoreHistory.eventId, id));
      // 3. The Event itself
      const [deleted] = await tx
        .delete(events)
        .where(eq(events.id, id))
        .returning({ id: events.id, title: events.title });

      if (!deleted) {
        throw new Error("Event not found");
      }

      // 4. Log the deletion in audit trail (through the service to keep the chain intact)
      await AuditService.logActionInternal(tx, {
        actorId: session.user!.id!,
        action: `Deleted Event: ${deleted.title} (${deleted.id})`,
        ipAddress: getClientIp(req),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error(error);
    if (error instanceof Error && error.message === "Event not found") {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
