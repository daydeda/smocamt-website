import { db } from "@/db";
import { attendance, events, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { AuditService } from "@/modules/audit/audit.service";
import { deductIndividualPoints } from "@/lib/points/award-individual-points";
import { NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";

export class NoShowStrikesService {
  // Students holding a 'registered' attendance row for this event with NO
  // 'attended' row anywhere in the event — i.e. they signed up and never checked
  // in on any session. Plain two-query set-difference (not a SQL subquery) to
  // match this codebase's existing straightforward query style.
  //
  // isStaff=false excludes event staff from the registered pool: staff commonly
  // register for an event they're running but are never personally scanned in
  // (they're operating the scanner, not being scanned) — without this filter
  // they'd be wrongly struck as no-shows, which can eventually block their own
  // future registrations via registrationBlocked.
  static async findNoShowStudentIds(eventId: string): Promise<string[]> {
    const attendedRows = await db
      .selectDistinct({ studentId: attendance.studentId })
      .from(attendance)
      .where(and(eq(attendance.eventId, eventId), eq(attendance.status, "attended")));
    const attendedIds = new Set(attendedRows.map((r) => r.studentId));

    const registeredRows = await db
      .selectDistinct({ studentId: attendance.studentId })
      .from(attendance)
      .where(and(eq(attendance.eventId, eventId), eq(attendance.status, "registered"), eq(attendance.isStaff, false)));

    return registeredRows.map((r) => r.studentId).filter((id) => !attendedIds.has(id));
  }

  /** The event columns the strike gate needs (end time + ownership scope). */
  static async getEventForStrikeGate(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, title: true, endTime: true, ownerClubIds: true, ownerMajors: true },
    });
  }

  /** The roster preview for the no-show confirm modal. */
  static async listStudentsForPreview(studentIds: string[]) {
    return db.query.users.findMany({
      where: inArray(users.id, studentIds),
      columns: { id: true, name: true, nickname: true, studentId: true, noShowCount: true },
    });
  }

  /** The students about to be struck, with the fields the strike needs. */
  static async listStrikeCandidates(studentIds: string[]) {
    return db.query.users.findMany({
      where: inArray(users.id, studentIds),
      columns: { id: true, name: true, houseId: true, points: true, noShowCount: true, registrationBlocked: true },
    });
  }

  /**
   * Strikes every candidate in ONE transaction: flips their 'registered' rows to
   * 'no_show' (guarded, so a concurrent apply can't double-strike), bumps the
   * strike count / registration block, deducts the penalty points and writes
   * the audit entry. Returns the totals.
   */
  static async applyNoShowStrikes(params: {
    eventId: string;
    eventTitle: string;
    candidates: Awaited<ReturnType<typeof NoShowStrikesService.listStrikeCandidates>>;
    penaltyPoints: number;
    actorId: string;
    ipAddress: string;
  }) {
    const { eventId, eventTitle, candidates, penaltyPoints, actorId, ipAddress } = params;
    let struck = 0;
    let blocked = 0;
    let pointsDeducted = 0;

    await db.transaction(async (tx) => {
      for (const student of candidates) {
        // Guarded flip: only rows still 'registered' for THIS student+event move
        // to 'no_show'. Zero rows back means another concurrent apply (or a
        // late scan) already resolved this student — skip them entirely so
        // they aren't double-struck.
        const flipped = await tx
          .update(attendance)
          .set({ status: "no_show" })
          .where(and(
            eq(attendance.eventId, eventId),
            eq(attendance.studentId, student.id),
            eq(attendance.status, "registered"),
          ))
          .returning({ id: attendance.id });
        if (flipped.length === 0) continue;

        const newNoShowCount = student.noShowCount + 1;
        const newBlocked = student.registrationBlocked || newNoShowCount >= NO_SHOW_STRIKE_THRESHOLD;

        await tx
          .update(users)
          .set({ noShowCount: newNoShowCount, registrationBlocked: newBlocked })
          .where(eq(users.id, student.id));

        const { newPoints } = await deductIndividualPoints(tx, {
          studentId: student.id,
          houseId: student.houseId,
          eventId,
          points: penaltyPoints,
          reason: `Deducted ${penaltyPoints} points: no-show strike ${newNoShowCount}/${NO_SHOW_STRIKE_THRESHOLD} at event "${eventTitle}"`,
        });

        await AuditService.logActionInternal(tx, {
          actorId,
          targetId: student.id,
          action: `No-show strike ${newNoShowCount}/${NO_SHOW_STRIKE_THRESHOLD} for event "${eventTitle}" (${eventId}); deducted ${penaltyPoints} points` +
            (newBlocked && !student.registrationBlocked ? "; registration blocked" : ""),
          ipAddress,
        });

        struck += 1;
        pointsDeducted += student.points - newPoints;
        if (newBlocked && !student.registrationBlocked) blocked += 1;
      }
    });

    return { struck, blocked, pointsDeducted };
  }
}
