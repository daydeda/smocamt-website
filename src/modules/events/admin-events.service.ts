import { db } from "@/db";
import { events, eventSessions, attendance, scoreHistory, eventProposals } from "@/db/schema";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { AuditService } from "@/modules/audit/audit.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import type { allowedEventYearsSchema, sessionInputSchema } from "@/lib/events/event-schema";
import { eventYearFields, getAllowedEventYears } from "@/lib/access/event-access";

// Fields accepted when updating (or creating) an event — the already-validated
// output of the routes' zod schemas (validation itself stays in the routes).
export type EventUpdateData = {
  title?: string;
  description?: string | null;
  startTime?: string;
  endTime?: string;
  registrationOpenTime?: string | null;
  registrationCloseTime?: string | null;
  quota?: number | null;
  location?: string | null;
  pointsAwarded?: number | null;
  individualPointsAwarded?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  walkInsEnabled?: boolean;
  walkInsOnly?: boolean;
  quotaWalkIn?: number | null;
  registrationMode?: "once" | "per_session";
  checkInMode?: "qr" | "evidence";
  requireCheckOut?: boolean;
  checkOutEvidenceRequired?: boolean;
  sessions?: z.infer<typeof sessionInputSchema>[];
  targetThai?: boolean;
  targetInternational?: boolean;
  quotaThai?: number | null;
  quotaInternational?: number | null;
  allowedRoles?: string[] | null;
  allowedMajors?: string[] | null;
  allowedClubs?: string[] | null;
  allowedYears?: z.infer<typeof allowedEventYearsSchema> | null;
  firstYearOnly?: boolean;
  managedByRoles?: string[] | null;
  ownerClubIds?: string[] | null;
  ownerMajors?: string[] | null;
  staffUserIds?: string[] | null;
  songsueLinked?: boolean;
  detailsReviewStatus?: "pending" | "approved";
  discardPendingDetails?: boolean;
};

export type EventCreateData = EventUpdateData & {
  title: string;
  startTime: string;
  endTime: string;
  // Present when this event is being created FROM a club_president's proposal.
  proposalId?: string;
};

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
  "quotaInternational", "firstYearOnly", "allowedYears",
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
    ...(data.checkInMode !== undefined && { checkInMode: data.checkInMode }),
    ...(data.requireCheckOut !== undefined && { requireCheckOut: data.requireCheckOut }),
    ...(data.checkOutEvidenceRequired !== undefined && { checkOutEvidenceRequired: data.checkOutEvidenceRequired }),
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
    ...eventYearFields(data),
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

export class AdminEventsService {
  /**
   * Updates an event in ONE transaction: a staff edit of the live columns, a
   * president's held-for-review pending diff, a staff discard of a pending diff,
   * or approval of a pending diff — plus the staff-flag sync, session
   * reconciliation and audit entry. `liveColumnsChanged` is true only when the
   * LIVE columns were written (gates the Songsue mirror). Throws
   * Error("EVENT_NOT_FOUND" | "UNAUTHORIZED_SCOPE" | "NO_SESSIONS_LEFT").
   */
  static async updateEvent(params: {
    id: string;
    data: EventUpdateData;
    posters: string[] | undefined;
    coverFromPosters: string | null | undefined;
    isAdminRole: boolean;
    myRoles: string[];
    actorId: string;
    ipAddress: string;
  }) {
    const { id, data, posters, coverFromPosters, isAdminRole, myRoles, actorId, ipAddress } = params;
    // Set true ONLY in the branch below that actually writes the events table's
    // LIVE columns (not the president pending-diff branch, and not the discard
    // branch, which never touches title/schedule/points/etc.) — gates the
    // Songsue mirror call after the transaction commits, so a president's
    // held-for-review edit or a no-op discard never fires a sync of stale data.
    let liveColumnsChanged = false;

    const updated = await db.transaction(async (tx) => {
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
        const scope = await EventScopeService.getPresidentScope(actorId, myRoles);
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
        const comparisonBase: Record<string, unknown> = { ...current, allowedYears: getAllowedEventYears(current), ...existingPending, ...eventYearFields(existingPending) };

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
            pendingDetailsSubmittedBy: actorId,
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
          actorId: actorId,
          action: `Submitted pending changes for review: ${row.title}`,
          ipAddress,
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
          actorId: actorId,
          action: `Discarded pending changes: ${row.title}`,
          ipAddress,
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
            detailsReviewedBy: data.detailsReviewStatus === "approved" ? actorId : null,
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
            evidenceNonce: s.evidenceNonce ?? null,
            evidencePrompt: s.evidencePrompt?.trim() ? s.evidencePrompt.trim() : null,
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
        actorId: actorId,
        action: approvingPending
          ? `Approved pending changes: ${row.title}`
          : `Updated Event: ${row.title}`,
        ipAddress,
      });

      return row;
    });

    return { updated, liveColumnsChanged };
  }

  /** Deletes an event, its attendance and score history, with the audit entry, in one transaction. Throws Error("Event not found"). */
  static async deleteEvent(id: string, actorId: string, ipAddress: string) {
    // Delete related records manually to avoid FK constraints if cascade isn't applied
    await db.transaction(async (tx) => {
      // 1. Attendance
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
        actorId: actorId,
        action: `Deleted Event: ${deleted.title} (${deleted.id})`,
        ipAddress: ipAddress,
      });
    });
  }

  /**
   * Creates an event with its sessions and audit entry (and, when created from a
   * president's proposal, flips that proposal to approved) in one transaction.
   */
  static async createEvent(params: {
    data: EventCreateData;
    posters: string[];
    cover: string | null;
    sessionsInput: { title?: string | null; startTime: string; endTime: string; quotaWalkIn?: number | null; evidenceNonce?: string | null; evidencePrompt?: string | null }[];
    actorId: string;
    ipAddress: string;
  }) {
    const { data, posters, cover, sessionsInput, actorId, ipAddress } = params;
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(events)
        .values({
          title: data.title,
          description: data.description,
          startTime: new Date(data.startTime),
          endTime: new Date(data.endTime),
          registrationOpenTime: data.registrationOpenTime ? new Date(data.registrationOpenTime) : null,
          registrationCloseTime: data.registrationCloseTime ? new Date(data.registrationCloseTime) : null,
          quota: data.quota,
          location: data.location,
          pointsAwarded: data.pointsAwarded ?? 0,
          individualPointsAwarded: data.individualPointsAwarded ?? 0,
          imageUrl: cover,
          imageUrls: posters,
          // walkInsOnly implies walkInsEnabled regardless of what the client sent —
          // an event that only accepts walk-ins obviously must accept walk-ins.
          walkInsEnabled: data.walkInsOnly ? true : (data.walkInsEnabled ?? false),
          walkInsOnly: data.walkInsOnly ?? false,
          quotaWalkIn: data.quotaWalkIn,
          registrationMode: data.registrationMode ?? "once",
          checkInMode: data.checkInMode ?? "qr",
          requireCheckOut: data.requireCheckOut ?? false,
          checkOutEvidenceRequired: data.checkOutEvidenceRequired ?? true,
          targetThai: data.targetThai ?? true,
          targetInternational: data.targetInternational ?? true,
          quotaThai: data.quotaThai,
          quotaInternational: data.quotaInternational,
          allowedRoles: data.allowedRoles && data.allowedRoles.length > 0 ? data.allowedRoles : null,
          allowedMajors: data.allowedMajors && data.allowedMajors.length > 0 ? data.allowedMajors : null,
          allowedClubs: data.allowedClubs && data.allowedClubs.length > 0 ? data.allowedClubs : null,
          ...eventYearFields(data),
          managedByRoles: data.managedByRoles && data.managedByRoles.length > 0 ? data.managedByRoles : null,
          ownerClubIds: data.ownerClubIds && data.ownerClubIds.length > 0 ? data.ownerClubIds : null,
          ownerMajors: data.ownerMajors && data.ownerMajors.length > 0 ? data.ownerMajors : null,
          staffUserIds: data.staffUserIds && data.staffUserIds.length > 0 ? data.staffUserIds : null,
          songsueLinked: data.songsueLinked ?? false,
          // Staff is creating (and has therefore already reviewed) every field
          // right now — unlike the DB column default of 'pending', which exists
          // for the president-edit-triggers-re-review case (see PUT
          // /api/admin/events/[id]). Without this, every brand-new event opened
          // in the editor showed a "pending review" banner with nothing to
          // review yet.
          detailsReviewStatus: "approved",
          detailsReviewedBy: actorId,
          detailsReviewedAt: new Date(),
        })
        .returning();

      await tx.insert(eventSessions).values(
        sessionsInput.map((s, i) => ({
          eventId: created.id,
          title: s.title?.trim() ? s.title.trim() : null,
          startTime: new Date(s.startTime),
          endTime: new Date(s.endTime),
          sortOrder: i,
          quotaWalkIn: s.quotaWalkIn ?? null,
          evidenceNonce: s.evidenceNonce ?? null,
          evidencePrompt: s.evidencePrompt?.trim() ? s.evidencePrompt.trim() : null,
        }))
      );

      // Log the event creation (through the service so the hash chain stays intact)
      await AuditService.logActionInternal(tx, {
        actorId: actorId,
        action: `Created Event: ${created.title} (${sessionsInput.length} session${sessionsInput.length > 1 ? "s" : ""})`,
        ipAddress,
      });

      // Approving a club_president's proposal is a SIDE EFFECT of staff creating
      // the real event from it, not a separate mutation — this rides the
      // already-audited create transaction instead of adding a second
      // privileged write path. The WHERE status='pending' guard means a
      // proposal that was concurrently withdrawn/rejected/already-approved is
      // simply left untouched; event creation still succeeds either way.
      if (data.proposalId) {
        const [linked] = await tx
          .update(eventProposals)
          .set({
            status: "approved",
            reviewedBy: actorId,
            reviewedAt: new Date(),
            resultingEventId: created.id,
            updatedAt: new Date(),
          })
          .where(and(eq(eventProposals.id, data.proposalId), eq(eventProposals.status, "pending")))
          .returning({ id: eventProposals.id });

        await AuditService.logActionInternal(tx, {
          actorId: actorId,
          action: linked
            ? `Approved event proposal ${data.proposalId} -> created event ${created.id}`
            : `Created event ${created.id} from proposal ${data.proposalId} (proposal was no longer pending; left untouched)`,
          ipAddress,
        });
      }

      return created;
    });
  }

  /** Per-event distinct-attendee counts (staff rows excluded). */
  static async getAttendeeCounts() {
    return db
      .select({
        eventId: attendance.eventId,
        count: sql<number>`count(distinct ${attendance.studentId})`,
      })
      .from(attendance)
      // Staff rows don't count toward the displayed "X registered" headcount —
      // mirrors the quota exemption in register/route.ts and scanner.service.ts.
      .where(eq(attendance.isStaff, false))
      .groupBy(attendance.eventId);
  }

  /** Every event (newest start first) with the pending-edit submitter. */
  static async listEventsWithSubmitter() {
    return db.query.events.findMany({
      orderBy: (events, { desc }) => [desc(events.startTime)],
      with: {
        // Joined so the pending-changes review banner can show who submitted
        // the edit, not just when — see events.pendingDetailsSubmittedBy.
        pendingSubmitter: { columns: { id: true, name: true } },
      },
    });
  }

  /** Sessions for every event in one query, in display order. */
  static async listAllSessions() {
    return db.query.eventSessions.findMany({
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.startTime)],
    });
  }
}
