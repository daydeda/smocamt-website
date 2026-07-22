import { db } from "@/db";
import { attendance, users, houses, scoreHistory, eventSessions, forms, formSubmissions } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { UsersService } from "../users/users.service";
import { EventsService } from "./events.service";
import { AuditService } from "../audit/audit.service";
import { HousesService } from "../houses/houses.service";
import { canGiveIndividualScore } from "@/lib/admin-access";
import { awardIndividualPoints } from "@/lib/award-individual-points";
import { syncRegistrationToSongsue, type SongsueEmergencyContact } from "@/lib/songsue-sync";

type ResolvedStudent = NonNullable<Awaited<ReturnType<typeof UsersService.resolveStudentByToken>>>;
type DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ScanResult {
  status: "success" | "success_walk_in" | "pending_confirmation" | "already_checked_in" | "not_found" | "quota_full" | "walk_ins_disabled" | "found" | "not_registered" | "error";
  student: {
    name: string;
    nickname: string | null;
    studentId: string | null;
    house: string;
    houseId?: string | null;
    houseColor: string;
    // Medical fields only included when operationally needed (pending/first check-in)
    hasMedicalCondition?: boolean;
    chronicDiseases?: string | null;
    medicalHistory?: string | null;
    drugAllergies?: string | null;
    foodAllergies?: string | null;
    dietaryRestrictions?: string | null;
    faintingHistory?: boolean | null;
    emergencyMedication?: string | null;
    points?: number | null;
  } | null;
  checkedInAt?: Date | null;
  error?: string;
  isWalkIn?: boolean;
  // Set on a confirmed check-in when the event has a takeable K_pre (pre-test) form
  // this student hasn't submitted. Walk-ins never pass through the dashboard pre-test
  // gate, so the scanner surfaces a warning + a deep-link/QR to complete it.
  preTestWarning?: { formId: string; title: string } | null;
}

const MAX_SCORE_AWARD = 500;

class QuotaFullError extends Error {
  constructor() { super("QUOTA_FULL"); }
}

class WalkInQuotaFullError extends Error {
  constructor() { super("WALK_IN_QUOTA_FULL"); }
}

export class ScannerService {
  static async processScan(params: {
    qrToken: string;
    eventId: string;
    // Which session (day) the check-in is recorded against. Resolved/defaulted by
    // the API to the "current" session; always belongs to eventId.
    sessionId: string;
    action: "scan" | "confirm" | "score" | "lookup";
    medsCheckOption?: string | null;
    score?: number;
    reason?: string;
    actorId: string;
    actorRole: string;
    ipAddress: string;
  }): Promise<ScanResult> {
    const { qrToken, eventId, sessionId, action, medsCheckOption, actorId, actorRole, ipAddress } = params;

    const [student, event, session] = await Promise.all([
      UsersService.resolveStudentByToken(qrToken),
      EventsService.getEventById(eventId),
      db.query.eventSessions.findFirst({
        where: and(eq(eventSessions.id, sessionId), eq(eventSessions.eventId, eventId)),
      }),
    ]);

    if (!student) return { status: "not_found", student: null, error: "Student not found in the system." };
    if (!event)   return { status: "not_found", student: null, error: "Event not found" };
    // The session must exist AND belong to this event — blocks a hand-crafted
    // cross-event sessionId from recording attendance against the wrong day.
    if (!session) return { status: "not_found", student: null, error: "Session not found for this event." };

    // Explicitly assigned event staff (event.staffUserIds — set by an admin,
    // NOT derived from global role) are exempt from quota on every insert path
    // below, and their attendance rows are flagged so they're excluded from
    // no-show strikes and quota/headcount recounts elsewhere.
    const isEventStaff = Array.isArray(event.staffUserIds) && event.staffUserIds.includes(student.id);

    // Human-readable day label for audit logs (e.g. "Day 1"). Sessions are ordered
    // by sortOrder; the title overrides when set.
    const sessionLabel = session.title?.trim() || "this session";

    // Per-attendee points this event grants on each attended check-in (0 = none).
    // Awarded inside every "attended" transition below, in the same transaction.
    const individualPoints = event.individualPointsAwarded ?? 0;

    const hasMedicalCondition = this.evaluateMedicalCondition(student);

    // Base info: safe to return in all contexts (no sensitive health data)
    const baseStudentInfo = {
      name: student.name,
      nickname: student.nickname,
      studentId: student.studentId,
      house: student.house?.name ?? "UNASSIGNED",
      houseId: student.house?.id,
      houseColor: student.house?.color ?? "#6366f1",
      points: student.points ?? 0,
    };

    // Medical DETAIL (raw free-text health records) is PDPA-restricted to
    // super_admin/admin. Every other scanning role (registration/organizer/smo) gets
    // only the boolean SIGNAL — enough to prompt a medical check at the gate without
    // ever shipping the underlying records in the JSON response (DevTools-readable).
    const canViewMedicalDetail = actorRole === "super_admin" || actorRole === "admin";

    // Signal-only view: what non-admin scanners receive at the gate.
    const studentWithSignal = { ...baseStudentInfo, hasMedicalCondition };

    // Full info: only super_admin/admin sees the detail fields; everyone else falls
    // back to the signal-only view.
    const studentWithMedical = canViewMedicalDetail
      ? {
          ...studentWithSignal,
          chronicDiseases: student.chronicDiseases,
          medicalHistory: student.medicalHistory,
          drugAllergies: student.drugAllergies,
          foodAllergies: student.foodAllergies,
          dietaryRestrictions: student.dietaryRestrictions,
          faintingHistory: student.faintingHistory,
          emergencyMedication: student.emergencyMedication,
        }
      : studentWithSignal;

    /* ── Lookup (score mode) ────────────────────────────────────────────────── */
    // Score mode resolves the student WITHOUT touching attendance (no check-in
    // side effect). Scoring is restricted to students who belong to this event:
    // a student with no attendance record (never registered and never walked in)
    // cannot be given or deducted points here.
    if (action === "lookup") {
      const record = await db.query.attendance.findFirst({
        where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, student.id)),
      });
      if (!record) {
        return {
          status: "not_registered",
          student: baseStudentInfo,
          error: "Student is not registered for this event.",
        };
      }
      // Scoring needs no medical data — return the PDPA-safe base info only.
      return {
        status: "found",
        student: baseStudentInfo,
        checkedInAt: record.status === "attended" ? record.checkInTime : undefined,
      };
    }

    /* ── Score Awarding ─────────────────────────────────────────────────────── */
    if (action === "score") {
      // Defense-in-depth: the scanner-only president roles are check-in only and
      // must never award/deduct individual points, even if a request reaches here.
      if (!canGiveIndividualScore(actorRole)) {
        return {
          status: "error",
          student: baseStudentInfo,
          error: "You do not have permission to give individual scores.",
        };
      }

      const parsedScore = params.score !== undefined ? Number(params.score) : 0;
      // Negative = deduction (penalty/correction); zero is a no-op and rejected.
      if (!Number.isInteger(parsedScore) || parsedScore === 0 || Math.abs(parsedScore) > MAX_SCORE_AWARD) {
        return {
          status: "error",
          student: baseStudentInfo,
          error: `Score must be a non-zero integer between -${MAX_SCORE_AWARD} and ${MAX_SCORE_AWARD}.`,
        };
      }

      // Gate scoring to event participants: a student with no attendance record
      // for this event cannot be scored. Enforced server-side (not just in the UI)
      // so a hand-crafted request can't award/deduct points off-event.
      const enrollment = await db.query.attendance.findFirst({
        where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, student.id)),
      });
      if (!enrollment) {
        return {
          status: "not_registered",
          student: baseStudentInfo,
          error: "Student is not registered for this event.",
        };
      }

      // Wording for logs/audit: "Awarded 5" vs "Deducted 5" reads better than "Awarded -5".
      const verb = parsedScore >= 0 ? "Awarded" : "Deducted";
      const magnitude = Math.abs(parsedScore);

      let newPoints = 0;

      await db.transaction(async (tx) => {
        // Atomic UPDATE: locks the row, increments, and returns the new value in
        // one round-trip. T2 blocks here until T1 commits, then reads the
        // already-incremented value — no separate SELECT FOR UPDATE needed.
        // Capture the TRUE pre-update balance under a row lock first, so the "from"
        // value in the audit line below and the milestone math are accurate.
        const [prevRow] = await tx
          .select({ points: users.points })
          .from(users)
          .where(eq(users.id, student.id))
          .for("update");
        const previousPoints = prevRow?.points ?? 0;

        const [result] = await tx
          .update(users)
          // No floor — a deduction may push a student negative, matching houses.points
          // (which has never floored at 0). Milestone math below only fires on an
          // upward crossing, so a negative balance can't accidentally claw back a
          // house bonus.
          .set({ points: sql`COALESCE(${users.points}, 0) + ${parsedScore}` })
          .where(eq(users.id, student.id))
          .returning({ newPoints: users.points });

        newPoints = result?.newPoints ?? previousPoints;

        if (student.houseId) {
          const logReason = params.reason?.trim()
            ? `${verb} ${magnitude} pts to ${student.name} - Reason: ${params.reason} (from activity "${event.title}")`
            : `${verb} ${magnitude} individual points to ${student.name} from activity "${event.title}"`;

          await tx.insert(scoreHistory).values({
            houseId: student.houseId,
            eventId: eventId || null,
            delta: 0,
            reason: logReason,
          });
        }

        const oldMilestones = Math.floor(previousPoints / 100);
        const newMilestones = Math.floor(newPoints / 100);
        const milestoneDiff = newMilestones - oldMilestones;

        let housePointsAdded = 0;
        if (milestoneDiff > 0 && student.houseId) {
          housePointsAdded = milestoneDiff * 2;
          await tx.update(houses)
            .set({ points: sql`${houses.points} + ${housePointsAdded}` })
            .where(eq(houses.id, student.houseId));
          await tx.insert(scoreHistory).values({
            houseId: student.houseId,
            eventId: eventId || null,
            delta: housePointsAdded,
            reason: `Student ${student.name} reached 100 point milestone (+${newPoints} total points) from activity "${event.title}"`,
          });
        }

        await AuditService.logActionInternal(tx, {
          actorId,
          targetId: student.id,
          action: `${verb} ${magnitude} individual points to ${student.name} for activity "${event.title}"` +
                  (params.reason?.trim() ? ` (Reason: ${params.reason})` : "") +
                  `. Points updated from ${previousPoints} to ${newPoints}.` +
                  (housePointsAdded > 0 ? ` House ${student.houseId} awarded +${housePointsAdded} points.` : ""),
          ipAddress,
        });
      });

      // Score responses omit medical data — not relevant to point awarding
      return { status: "success", student: { ...baseStudentInfo, points: newPoints } };
    }

    /* ── Check-in: session-registered path ──────────────────────────────────── */
    // The check-in key is the SESSION (day), not the event. A row here means the
    // student is registered for — or already attended — THIS specific session.
    const record = await db.query.attendance.findFirst({
      where: and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, student.id)),
    });

    if (record) {
      if (record.status === "attended") {
        // Already done — return base info only (no reason to re-expose medical data)
        return { status: "already_checked_in", student: baseStudentInfo, checkedInAt: record.checkInTime };
      }

      if (action === "confirm") {
        // Atomic update: WHERE status IN ('registered','no_show') ensures only one
        // concurrent confirm wins (0 rows back → already_checked_in), while still
        // letting a late arrival check in — apply-strikes flips unattended rows to
        // 'no_show', and without 'no_show' here that flip would permanently lock the
        // student out of confirming (surfaced as a misleading "already checked in").
        // The prior strike's point deduction/noShowCount is NOT reversed by this —
        // that's a separate, deliberate call an organizer can review manually.
        const updated = await db.transaction(async (tx) => {
          const rows = await tx
            .update(attendance)
            .set({
              status: "attended",
              checkInTime: new Date(),
              scannedBy: actorId,
              medsCheckOption: medsCheckOption || null,
            })
            .where(and(eq(attendance.id, record.id), inArray(attendance.status, ["registered", "no_show"])))
            .returning({ id: attendance.id });

          if (rows.length > 0) {
            await this.awardAttendanceIndividualPoints(tx, {
              studentId: student.id,
              studentName: student.name,
              houseId: student.houseId,
              eventId,
              eventTitle: event.title,
              points: individualPoints,
              sessionLabel,
            });
            await AuditService.logActionInternal(tx, {
              actorId,
              targetId: student.id,
              action: `Confirmed check-in for pre-registered event: ${event.title} (${sessionLabel})`,
              ipAddress,
            });
          }
          return rows;
        });

        if (updated.length === 0) {
          return { status: "already_checked_in", student: baseStudentInfo };
        }
        await this.syncAttendedToSongsue(student, event);
        const preTestWarning = await this.getPreTestWarning(eventId, student.id);
        return {
          status: "success",
          student: await this.withAssignedHouse(student, studentWithMedical),
          preTestWarning,
        };
      }

      // Scan only — staff sees medical alert before deciding to confirm. PDPA: record
      // the medical-detail view (admin/super_admin only) since no check-in transaction
      // logs it on this non-mutating path.
      if (canViewMedicalDetail && hasMedicalCondition) {
        await this.logMedicalDetailView({
          actorId, targetId: student.id, studentName: student.name,
          eventTitle: event.title, ipAddress, context: "registered scan",
        });
      }
      return { status: "pending_confirmation", student: studentWithMedical };
    }

    /* ── Check-in: 'once'-mode, first time at THIS session ───────────────────── */
    // In 'once' mode a student registers once for the whole event and may attend
    // any/all sessions. With no row for THIS session yet but an event-level
    // registration, the scan is an attendable check-in — create a fresh attended
    // row for this session (counted as 'pre-registered', not a walk-in).
    if (event.registrationMode === "once") {
      const eventReg = await db.query.attendance.findFirst({
        where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, student.id)),
      });
      if (eventReg) {
        if (action === "confirm") {
          const inserted = await db.transaction(async (tx) => {
            // ON CONFLICT DO NOTHING handles a race where the session row was
            // created between the findFirst above and this insert.
            const rows = await tx
              .insert(attendance)
              .values({
                eventId,
                sessionId,
                studentId: student.id,
                scannedBy: actorId,
                method: "pre-registered",
                status: "attended",
                checkInTime: new Date(),
                medsCheckOption: medsCheckOption || null,
                isStaff: isEventStaff,
              })
              .onConflictDoNothing()
              .returning({ id: attendance.id });

            if (rows.length > 0) {
              await this.awardAttendanceIndividualPoints(tx, {
                studentId: student.id,
                studentName: student.name,
                houseId: student.houseId,
                eventId,
                eventTitle: event.title,
                points: individualPoints,
                sessionLabel,
              });
              await AuditService.logActionInternal(tx, {
                actorId,
                targetId: student.id,
                action: `Confirmed check-in for pre-registered event: ${event.title} (${sessionLabel})`,
                ipAddress,
              });
            }
            return rows;
          });

          if (inserted.length === 0) {
            return { status: "already_checked_in", student: baseStudentInfo };
          }
          await this.syncAttendedToSongsue(student, event);
          const preTestWarning = await this.getPreTestWarning(eventId, student.id);
          return { status: "success", student: studentWithMedical, preTestWarning };
        }
        if (canViewMedicalDetail && hasMedicalCondition) {
          await this.logMedicalDetailView({
            actorId, targetId: student.id, studentName: student.name,
            eventTitle: event.title, ipAddress, context: "once-mode scan",
          });
        }
        return { status: "pending_confirmation", student: studentWithMedical };
      }
    }

    /* ── Check-in: walk-in path ─────────────────────────────────────────────── */
    if (!event.walkInsEnabled) {
      return {
        status: "walk_ins_disabled",
        student: baseStudentInfo,
        error: "Walk-ins are not enabled for this event and student is not pre-registered.",
      };
    }

    if (action === "confirm") {
      // Walk-in quota is PER SESSION (walk-ins re-open each day): prefer the
      // session's own sub-cap, falling back to the event-wide one for legacy events.
      const sessionWalkIn = session.quotaWalkIn ?? event.quotaWalkIn ?? null;
      try {
        await db.transaction(async (tx) => {
          // Staff walking themselves in are exempt from both quota checks below
          // (they're working the event, not taking a participant's seat).
          // quota === 0 means unlimited (mirrors the register route's own
          // `quota !== null && quota > 0` convention) — 0 must NOT be treated as
          // a real cap of zero seats.
          if (!isEventStaff && ((event.quota !== null && event.quota > 0) || sessionWalkIn !== null)) {
            // Lock the SESSION row so concurrent walk-in confirms for the same day
            // serialize here, then recount within the session — quota is per-day,
            // closing the TOCTOU window without blocking other sessions.
            await tx
              .select({ id: eventSessions.id })
              .from(eventSessions)
              .where(eq(eventSessions.id, sessionId))
              .for("update");

            if (event.quota !== null && event.quota > 0) {
              // Walk-ins are ADDITIVE capacity on top of the per-session seat quota:
              // the day's room cap is quota + sessionWalkIn. The walk-in sub-limit
              // below still caps how many of those extra slots walk-ins take.
              // Staff-flagged rows never count toward this either.
              const totalCap = event.quota + (sessionWalkIn ?? 0);
              const [{ n }] = await tx
                .select({ n: sql<number>`count(*)` })
                .from(attendance)
                .where(and(eq(attendance.sessionId, sessionId), eq(attendance.status, "attended"), eq(attendance.isStaff, false)));

              if (Number(n) >= totalCap) throw new QuotaFullError();
            }

            if (sessionWalkIn !== null) {
              const [{ nWalkIn }] = await tx
                .select({ nWalkIn: sql<number>`count(*)` })
                .from(attendance)
                .where(
                  and(
                    eq(attendance.sessionId, sessionId),
                    eq(attendance.status, "attended"),
                    eq(attendance.method, "walk-in"),
                    eq(attendance.isStaff, false)
                  )
                );

              if (Number(nWalkIn) >= sessionWalkIn) throw new WalkInQuotaFullError();
            }
          }

          // ON CONFLICT DO NOTHING handles a race where the student was registered
          // for this session between the findFirst above and this insert.
          const inserted = await tx
            .insert(attendance)
            .values({
              eventId,
              sessionId,
              studentId: student.id,
              scannedBy: actorId,
              method: "walk-in",
              status: "attended",
              checkInTime: new Date(),
              medsCheckOption: medsCheckOption || null,
              isStaff: isEventStaff,
            })
            .onConflictDoNothing()
            .returning({ id: attendance.id });

          if (inserted.length === 0) throw new Error("ALREADY_CHECKED_IN");

          await this.awardAttendanceIndividualPoints(tx, {
            studentId: student.id,
            studentName: student.name,
            houseId: student.houseId,
            eventId,
            eventTitle: event.title,
            points: individualPoints,
            sessionLabel,
          });
          await AuditService.logActionInternal(tx, {
            actorId,
            targetId: student.id,
            action: `Recorded walk-in check-in for event: ${event.title} (${sessionLabel})`,
            ipAddress,
          });
        });
      } catch (e) {
        if (e instanceof QuotaFullError) {
          return { status: "quota_full", student: null, error: "Event is full. Walk-ins cannot be accepted." };
        }
        if (e instanceof WalkInQuotaFullError) {
          return { status: "quota_full", student: null, error: "Walk-in quota is full. Walk-ins cannot be accepted." };
        }
        if (e instanceof Error && e.message === "ALREADY_CHECKED_IN") {
          return { status: "already_checked_in", student: baseStudentInfo };
        }
        throw e;
      }

      await this.syncAttendedToSongsue(student, event);
      const preTestWarning = await this.getPreTestWarning(eventId, student.id);
      return {
        status: "success_walk_in",
        student: await this.withAssignedHouse(student, studentWithMedical),
        preTestWarning,
      };
    }

    // Walk-in scan only — staff sees medical alert before deciding to confirm. PDPA:
    // record the medical-detail view (admin/super_admin only); the non-mutating scan
    // path has no check-in transaction to log it.
    if (canViewMedicalDetail && hasMedicalCondition) {
      await this.logMedicalDetailView({
        actorId, targetId: student.id, studentName: student.name,
        eventTitle: event.title, ipAddress, context: "walk-in scan",
      });
    }
    return { status: "pending_confirmation", isWalkIn: true, student: studentWithMedical };
  }

  /**
   * Fallback safety net, not the primary path: houses are now assigned at
   * onboarding completion (POST /api/profile), so for the vast majority of
   * students this is a no-op read. This only does real work for a student who
   * somehow still has no house at check-in time (e.g. onboarded before that
   * change, or an admin cleared houseId). If the student already has one,
   * returns it unchanged. Otherwise picks the least-populated colour house
   * WITHIN the student's faculty and persists it race-safely (the WHERE
   * house_id IS NULL guard means a concurrent scan can't double-assign).
   * Returns the house fields to surface in the scan result.
   */
  private static async ensureHouseAssigned(
    student: ResolvedStudent
  ): Promise<{ name: string; id: string | null; color: string }> {
    if (student.houseId && student.house) {
      return {
        name: student.house.name,
        id: student.house.id,
        color: student.house.color ?? "#6366f1",
      };
    }

    const houseId = await HousesService.pickBalancedHouseIdForFaculty(student.faculty);
    if (houseId) {
      await db
        .update(users)
        .set({ houseId, updatedAt: new Date() })
        .where(and(eq(users.id, student.id), isNull(users.houseId)));
    }

    // Re-read so a concurrent scan that won the race is reflected too.
    const fresh = await db.query.users.findFirst({
      where: eq(users.id, student.id),
      columns: { houseId: true },
      with: { house: true },
    });
    const house = fresh?.house;
    return {
      name: house?.name ?? "UNASSIGNED",
      id: house?.id ?? null,
      color: house?.color ?? "#6366f1",
    };
  }

  /**
   * Returns a copy of the scan-result student info with its house fields set to
   * the student's (possibly just-assigned) house. Used on confirmed check-ins.
   */
  private static async withAssignedHouse<
    T extends { house: string; houseId?: string | null; houseColor: string }
  >(student: ResolvedStudent, info: T): Promise<T> {
    const h = await this.ensureHouseAssigned(student);
    return { ...info, house: h.name, houseId: h.id, houseColor: h.color };
  }

  /**
   * Mirrors a confirmed check-in into Songsue when the event is `songsueLinked`
   * — see src/lib/songsue-sync.ts. Called AFTER the check-in transaction commits
   * (never inside it): this is a best-effort HTTP call to a sibling app and must
   * never delay or fail a real check-in. No-op when the event isn't linked.
   */
  private static async syncAttendedToSongsue(
    student: ResolvedStudent,
    event: NonNullable<Awaited<ReturnType<typeof EventsService.getEventById>>>
  ): Promise<void> {
    if (!event.songsueLinked) return;
    await syncRegistrationToSongsue({
      externalEventId: event.id,
      user: {
        email: student.email,
        studentId: student.studentId,
        name: student.name,
        prefix: student.prefix,
        faculty: student.faculty,
        major: student.major,
        phone: student.phone,
        nickname: student.nickname,
        image: student.image,
        religion: student.religion,
        contactChannels: student.contactChannels,
        chronicDiseases: student.chronicDiseases,
        medicalHistory: student.medicalHistory,
        drugAllergies: student.drugAllergies,
        foodAllergies: student.foodAllergies,
        dietaryRestrictions: student.dietaryRestrictions,
        faintingHistory: student.faintingHistory,
        emergencyMedication: student.emergencyMedication,
        emergencyContacts: student.emergencyContacts as SongsueEmergencyContact[] | null,
      },
      status: "attended",
    });
  }

  /**
   * Awards an event's per-attendee `individualPointsAwarded` to a student the moment
   * their check-in becomes 'attended'. Runs INSIDE the caller's check-in transaction,
   * so the points and the attendance row commit together — and only when the row
   * actually transitioned (the callers guard on rows.length > 0), which keeps it
   * idempotent: a re-scan that updates 0 rows never re-awards. Per-day by design —
   * each attended session check-in awards again. No-op when the event grants 0.
   *
   * Mirrors the manual 'score' action: increments users.points, fires the same 100-pt
   * milestone house bonus, and writes a score_history row. No audit log here — the
   * check-in itself is already audited by each caller.
   */
  private static async awardAttendanceIndividualPoints(
    tx: DBTransaction,
    params: {
      studentId: string;
      studentName: string;
      houseId: string | null;
      eventId: string;
      eventTitle: string;
      points: number;
      sessionLabel: string;
    }
  ): Promise<void> {
    const { studentId, studentName, houseId, eventId, eventTitle, points, sessionLabel } = params;
    await awardIndividualPoints(tx, {
      studentId,
      studentName,
      houseId,
      eventId,
      points,
      reason: `Awarded ${points} individual points to ${studentName} for attending "${eventTitle}" (${sessionLabel})`,
      activityLabel: eventTitle,
    });
  }

  /**
   * Pre-test (K_pre) gate for check-ins. Pre-registered students are forced through
   * the pre-test at the dashboard before attending, but walk-ins never touch it — so
   * after a confirmed check-in we surface a warning when the event has a takeable
   * K_pre form this student hasn't submitted yet. The scanner renders this as a
   * deep-link/QR (/dashboard/history?form=...&event=...) the attendee can complete
   * on their own phone. Reads only form metadata — no medical data, no audit needed.
   */
  private static async getPreTestWarning(
    eventId: string,
    studentUserId: string
  ): Promise<{ formId: string; title: string } | null> {
    const preTest = await db.query.forms.findFirst({
      where: and(eq(forms.eventId, eventId), eq(forms.formType, "K_pre")),
      orderBy: (f, { asc }) => [asc(f.sortOrder)],
    });
    // No pre-test, or it's been manually deactivated → nothing to warn about.
    if (!preTest || preTest.isActive === false) return null;
    // Skip if the pre-test window has fully closed — it can no longer be taken.
    if (preTest.closesAt && preTest.closesAt.getTime() < Date.now()) return null;

    const submitted = await db.query.formSubmissions.findFirst({
      where: and(
        eq(formSubmissions.formId, preTest.id),
        eq(formSubmissions.studentId, studentUserId)
      ),
      columns: { id: true },
    });
    if (submitted) return null;

    return { formId: preTest.id, title: preTest.title };
  }

  /**
   * Best-effort audit of an admin viewing a student's medical DETAIL at the scanner
   * on a non-mutating scan (the 'pending_confirmation' path), which otherwise leaves
   * no trail — the check-in transactions log the confirm, but a scan that stops at
   * the medical alert does not. PDPA: medical-detail reads must be logged. Swallows
   * its own errors so a transient audit failure never blocks check-in at a live event.
   */
  private static async logMedicalDetailView(params: {
    actorId: string;
    targetId: string;
    studentName: string;
    eventTitle: string;
    ipAddress: string;
    context: string;
  }): Promise<void> {
    try {
      await AuditService.logAction({
        actorId: params.actorId,
        targetId: params.targetId,
        action: `Viewed medical detail at scanner (${params.context}) for ${params.studentName} — event "${params.eventTitle}"`,
        ipAddress: params.ipAddress,
      });
    } catch (e) {
      console.error("Failed to audit scanner medical-detail view:", e);
    }
  }

  static async searchStudents(query: string) {
    // Escape LIKE metacharacters so a query of "%" or "_" can't wildcard-match
    // the whole table; the search should only ever match literal substrings.
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    return await db.query.users.findMany({
      where: (users, { or, like }) =>
        or(
          like(users.studentId, `%${escaped}%`),
          like(users.name, `%${escaped}%`),
          like(users.nickname, `%${escaped}%`)
        ),
      // No qrToken here: it's a long-lived check-in credential, and the manual
      // check-in flow resolves students by plain id instead.
      columns: {
        id: true,
        studentId: true,
        name: true,
        nickname: true,
        houseId: true,
      },
      with: { house: true },
      limit: 10,
    });
  }

  private static evaluateMedicalCondition(student: ResolvedStudent): boolean {
    const checkMedical = (val?: string | null) => {
      if (!val) return false;
      const clean = val.trim().toLowerCase();
      const negativeValues = [
        "", "-", "ไม่มี", "ไม่มีโรคประจำตัว", "ไม่มีประวัติแพ้ยา",
        "ไม่มีประวัติแพ้อาหาร", "ไม่มีโรค", "ไม่มีแพ้ยา",
        "ไม่มีแพ้อาหาร", "ปกติ", "none", "no", "n/a", "nil"
      ];
      return !negativeValues.includes(clean);
    };

    return !!(
      student.faintingHistory ||
      checkMedical(student.chronicDiseases) ||
      checkMedical(student.medicalHistory) ||
      checkMedical(student.drugAllergies) ||
      checkMedical(student.foodAllergies) ||
      checkMedical(student.dietaryRestrictions) ||
      checkMedical(student.emergencyMedication)
    );
  }
}
