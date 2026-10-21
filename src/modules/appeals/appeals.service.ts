import { db } from "@/db";
import { attendance, events, noShowAppeals, users } from "@/db/schema";
import { NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import { AuditService } from "@/modules/audit/audit.service";
import { and, desc, eq } from "drizzle-orm";

// Thrown inside the transaction when the appeal was resolved by a concurrent
// request between the pre-check and the update (double-click, two admins).
export class AlreadyResolvedError extends Error {}

export class AppealsService {
  /** No-show appeals for staff review, newest first, optionally filtered by status. */
  static async listForReview(status: string | null) {
    return db.query.noShowAppeals.findMany({
      where: status ? eq(noShowAppeals.status, status) : undefined,
      orderBy: [desc(noShowAppeals.createdAt)],
      with: {
        user: {
          columns: { id: true, name: true, studentId: true, noShowCount: true, registrationBlocked: true },
          with: { house: { columns: { id: true, name: true, color: true } } },
        },
        event: { columns: { id: true, title: true, endTime: true, ownerClubIds: true, ownerMajors: true } },
        reviewer: {
          columns: { id: true, name: true },
        },
      },
    });
  }

  /** One appeal (with its event's owner scope) for the resolve pre-checks. */
  static async getAppealForResolve(id: string) {
    return db.query.noShowAppeals.findFirst({
      where: eq(noShowAppeals.id, id),
      columns: { id: true, userId: true, eventId: true, status: true, noShowCountAtAppeal: true },
      with: { event: { columns: { title: true, ownerClubIds: true, ownerMajors: true } } },
    });
  }

  /**
   * Approves or rejects an appeal. Approving also decrements the student's
   * noShowCount by one and flips that event's no-show attendance rows to
   * 'excused'; everything plus the audit log runs in one transaction. Throws
   * AlreadyResolvedError if a concurrent request resolved the appeal first.
   */
  static async resolveAppeal(params: {
    id: string;
    appeal: { userId: string; eventId: string | null };
    action: "approve" | "reject";
    note?: string;
    newStatus: string;
    reviewerId: string;
    ipAddress: string;
  }) {
    const { id, appeal, action: resolveAction, note, newStatus, reviewerId, ipAddress } = params;
    await db.transaction(async (tx) => {
      // Re-assert 'pending' inside the transaction (not just the pre-check above) so
      // a concurrent PATCH on the same appeal — double-click, or two admins — can't
      // silently overwrite an already-resolved outcome (e.g. a reject clobbering an
      // approve that already decremented the student's strikes).
      const [updated] = await tx
        .update(noShowAppeals)
        .set({
          status: newStatus,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        })
        .where(and(eq(noShowAppeals.id, id), eq(noShowAppeals.status, "pending")))
        .returning({ id: noShowAppeals.id });

      if (!updated) {
        throw new AlreadyResolvedError();
      }

      let action = `${resolveAction === "approve" ? "Approved" : "Rejected"} no-show appeal ${id}`;

      if (resolveAction === "approve") {
        const [student] = await tx
          .select({ noShowCount: users.noShowCount })
          .from(users)
          .where(eq(users.id, appeal.userId));
        const newCount = Math.max(0, (student?.noShowCount ?? 0) - 1);
        const newBlocked = newCount >= NO_SHOW_STRIKE_THRESHOLD;

        await tx
          .update(users)
          .set({ noShowCount: newCount, registrationBlocked: newBlocked })
          .where(eq(users.id, appeal.userId));

        // Clears the event of its no-show mark so it stops counting toward
        // future strike displays; a multi-session event may have flipped more
        // than one attendance row when the strike was originally applied.
        await tx
          .update(attendance)
          .set({ status: "excused" })
          .where(and(
            eq(attendance.studentId, appeal.userId),
            eq(attendance.eventId, appeal.eventId!),
            eq(attendance.status, "no_show"),
          ));

        action += `, removed 1 strike for event ${appeal.eventId} (was ${student?.noShowCount ?? 0}/${NO_SHOW_STRIKE_THRESHOLD}, now ${newCount}/${NO_SHOW_STRIKE_THRESHOLD})`;
      }

      await AuditService.logActionInternal(tx, {
        actorId: reviewerId,
        targetId: appeal.userId,
        action,
        ipAddress,
      });
    });
  }

  /** A student's no-show attendance rows (with event) for the appeals list. */
  static async listNoShowRowsForStudent(studentId: string) {
    return db.query.attendance.findMany({
      where: and(eq(attendance.studentId, studentId), eq(attendance.status, "no_show")),
      columns: { id: true },
      with: { event: { columns: { id: true, title: true, endTime: true } } },
    });
  }

  /** A student's appeals, newest first. */
  static async listAppealsForStudent(studentId: string) {
    return db.query.noShowAppeals.findMany({
      where: and(eq(noShowAppeals.userId, studentId)),
      orderBy: [desc(noShowAppeals.createdAt)],
      columns: {
        id: true,
        eventId: true,
        status: true,
        message: true,
        reviewNote: true,
        createdAt: true,
        reviewedAt: true,
      },
    });
  }

  /** The student's strike count and their no-show attendance row for one event. */
  static async getStudentStrikeContext(studentId: string, eventId: string) {
    const [student, noShowRow] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, studentId),
        columns: { noShowCount: true },
      }),
      db.query.attendance.findFirst({
        where: and(
          eq(attendance.studentId, studentId),
          eq(attendance.eventId, eventId),
          eq(attendance.status, "no_show"),
        ),
        columns: { id: true },
      }),
    ]);
    return { student, noShowRow };
  }

  /** The student's pending appeal for an event, if any. */
  static async findPendingAppeal(studentId: string, eventId: string) {
    return db.query.noShowAppeals.findFirst({
      where: and(
        eq(noShowAppeals.userId, studentId),
        eq(noShowAppeals.eventId, eventId),
        eq(noShowAppeals.status, "pending"),
      ),
      columns: { id: true },
    });
  }

  /** Inserts a new appeal and returns its id, status and creation time. */
  static async createAppeal(values: {
    userId: string;
    eventId: string;
    message: string;
    noShowCountAtAppeal: number;
  }) {
    const [appeal] = await db
      .insert(noShowAppeals)
      .values(values)
      .returning({ id: noShowAppeals.id, status: noShowAppeals.status, createdAt: noShowAppeals.createdAt });
    return appeal;
  }

  /** Event title + owner scope, used to address the new-appeal push. */
  static async getEventForNotification(eventId: string) {
    return db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { title: true, ownerClubIds: true, ownerMajors: true },
    });
  }
}
