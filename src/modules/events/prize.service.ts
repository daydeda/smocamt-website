import { db } from "@/db";
import { attendance, events, prizeClaims, prizes, users } from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { UsersService } from "../users/users.service";
import { AuditService } from "../audit/audit.service";
import {
  isDuplicateClaim,
  isPrizeOpen,
  meetsCheckInRequirement,
  type PrizeEligibilityInput,
} from "@/lib/prize-eligibility";

// Prize claim (การรับรางวัล) — see docs/features/prize-claim.md.
//
// Two invariants this service exists to hold:
//   1. A prize is NOT owned by an event. Uniqueness is anchored to the PRIZE, so
//      a student can't collect the same แก้ว once at the event and again at a
//      pickup counter next week.
//   2. Nothing here may create or imply an `attendance` row, award points, or
//      touch quota/strikes. Attendance is READ (for the eligibility check and
//      the report's "วันที่เข้าร่วมกิจกรรม" column) and never written.

// Postgres unique_violation. The (prizeId, studentId) partial unique index is
// the real duplicate guarantee — a pre-check alone loses the race when two
// staffers scan the same student on two phones in the same second, so we let
// the insert fail and translate the error rather than trusting the read.
const PG_UNIQUE_VIOLATION = "23505";

export interface PrizeClaimStudent {
  id: string;
  name: string;
  nickname: string | null;
  studentId: string | null;
}

export interface PrizeClaimResult {
  status:
    | "success"          // handed over, row written
    | "already_claimed"  // รับไปแล้ว — the anti-duplicate case
    | "not_eligible"     // requireCheckIn set and they didn't attend
    | "prize_closed"
    | "not_found"        // no such student / prize
    | "error";
  student: PrizeClaimStudent | null;
  claimId?: string;
  // Populated on "already_claimed" so the booth screen can say
  // "รับไปแล้วเมื่อ <date> โดย <staff>" instead of a bare refusal.
  existingClaim?: {
    claimedAt: Date;
    claimedByName: string | null;
  };
  // Populated on "not_eligible": which event they needed to attend.
  requiredEventTitle?: string | null;
  error?: string;
}

export class PrizeService {
  /**
   * Resolve a scanned QR (or a picked user id) to the student, and say what
   * WOULD happen — without writing anything. Backs the scan preview screen so
   * staff sees "รับไปแล้ว" before they physically hand the item over.
   */
  static async previewClaim(params: {
    prizeId: string;
    qrToken: string;
    ipAddress: string;
  }): Promise<PrizeClaimResult> {
    const { prizeId, qrToken, ipAddress } = params;

    const [prize, student] = await Promise.all([
      db.query.prizes.findFirst({ where: eq(prizes.id, prizeId) }),
      UsersService.resolveStudentByToken(qrToken, ipAddress),
    ]);

    if (!prize) return { status: "not_found", student: null, error: "Prize not found" };
    if (!student) return { status: "not_found", student: null, error: "Student not found in the system." };

    return await PrizeService.evaluate(prize, PrizeService.toClaimStudent(student));
  }

  /**
   * Hand a prize over: evaluate, then write the claim row.
   *
   * The photo is deliberately NOT part of this call — the row commits first and
   * the photo is attached afterwards (see attachPhoto). A dead venue wifi must
   * not be able to stop staff recording a handover, because that would also
   * switch off the duplicate check for everyone behind them in the queue.
   */
  static async claim(params: {
    prizeId: string;
    // Either a scanned QR token, or a userId picked from the manual search
    // fallback. Never a free-text name/รหัสนักศึกษา — a claim must always point
    // at a real users row.
    qrToken?: string;
    studentUserId?: string;
    // Where the handover physically happened, when that was at an event at all.
    eventId?: string | null;
    note?: string | null;
    actorId: string;
    ipAddress: string;
  }): Promise<PrizeClaimResult> {
    const { prizeId, qrToken, studentUserId, eventId, note, actorId, ipAddress } = params;

    const prize = await db.query.prizes.findFirst({ where: eq(prizes.id, prizeId) });
    if (!prize) return { status: "not_found", student: null, error: "Prize not found" };

    const resolved = qrToken
      ? await UsersService.resolveStudentByToken(qrToken, ipAddress)
      : studentUserId
        ? await db.query.users.findFirst({ where: eq(users.id, studentUserId) })
        : null;
    if (!resolved) return { status: "not_found", student: null, error: "Student not found in the system." };

    const student = PrizeService.toClaimStudent(resolved);

    const pre = await PrizeService.evaluate(prize, student);
    if (pre.status !== "success") return pre;

    try {
      const [row] = await db
        .insert(prizeClaims)
        .values({
          prizeId: prize.id,
          studentId: student.id,
          // Snapshot: renaming/deleting the prize later must not rewrite a
          // report already sent to คณบดี.
          prizeName: prize.name,
          eventId: eventId ?? null,
          claimedBy: actorId,
          method: qrToken ? "qr" : "manual",
          note: note ?? null,
          // Copied so the partial unique index can enforce the rule in Postgres.
          onePerStudent: prize.onePerStudent,
        })
        .returning({ id: prizeClaims.id });

      await AuditService.logAction({
        actorId,
        targetId: student.id,
        action: `Awarded prize "${prize.name}" (claim ${row.id}, method ${qrToken ? "qr" : "manual"})`,
        ipAddress,
      });

      return { status: "success", student, claimId: row.id };
    } catch (e) {
      // Lost the race against a concurrent scan of the same student — the index
      // did its job. Re-read and report it as the ordinary duplicate case.
      if (PrizeService.isUniqueViolation(e)) {
        return await PrizeService.alreadyClaimed(prize.id, student);
      }
      throw e;
    }
  }

  /**
   * Attach (or replace) the proof photo on an existing claim. Separate from
   * claim() on purpose — see the note there.
   */
  static async attachPhoto(params: {
    claimId: string;
    photoKey: string;
    actorId: string;
    ipAddress: string;
  }) {
    const { claimId, photoKey, actorId, ipAddress } = params;

    const [row] = await db
      .update(prizeClaims)
      .set({ photoKey, updatedAt: new Date() })
      .where(eq(prizeClaims.id, claimId))
      .returning({ id: prizeClaims.id, studentId: prizeClaims.studentId, prizeName: prizeClaims.prizeName });
    if (!row) return null;

    await AuditService.logAction({
      actorId,
      targetId: row.studentId,
      action: `Attached prize proof photo (claim ${claimId}, prize "${row.prizeName}")`,
      ipAddress,
    });
    return row;
  }

  /**
   * super_admin only (gated at the route). Removes the PHOTO and keeps the CLAIM
   * ROW: dropping the row would make the duplicate check forget the student and
   * let them collect a second one. Returns the freed storage key so the caller
   * can delete the object itself.
   */
  static async clearPhoto(params: { claimId: string; actorId: string; ipAddress: string }) {
    const { claimId, actorId, ipAddress } = params;

    const existing = await db.query.prizeClaims.findFirst({ where: eq(prizeClaims.id, claimId) });
    if (!existing?.photoKey) return null;

    await db
      .update(prizeClaims)
      .set({ photoKey: null, updatedAt: new Date() })
      .where(eq(prizeClaims.id, claimId));

    await AuditService.logAction({
      actorId,
      targetId: existing.studentId,
      action: `Deleted prize proof photo (claim ${claimId}, prize "${existing.prizeName}") — claim record retained`,
      ipAddress,
    });

    return { photoKey: existing.photoKey };
  }

  /**
   * Revoke a wrongly-given prize. Gated to super_admin/admin at the route: this
   * DOES free the student to claim again, so it is the one path that can undo
   * the duplicate guarantee and must leave a trail.
   */
  static async revokeClaim(params: { claimId: string; reason: string; actorId: string; ipAddress: string }) {
    const { claimId, reason, actorId, ipAddress } = params;

    const existing = await db.query.prizeClaims.findFirst({ where: eq(prizeClaims.id, claimId) });
    if (!existing) return null;

    await db.delete(prizeClaims).where(eq(prizeClaims.id, claimId));

    await AuditService.logAction({
      actorId,
      targetId: existing.studentId,
      action: `Revoked prize claim ${claimId} ("${existing.prizeName}") — reason: ${reason}`,
      ipAddress,
    });

    return { photoKey: existing.photoKey, studentId: existing.studentId };
  }

  /**
   * Claim rows for one prize, joined with the identity + attendance data the
   * dean report needs. ONE query behind BOTH renderings (.xlsx and the PDF
   * print page) so the two artefacts can never disagree.
   */
  static async getClaimsForReport(prizeId: string) {
    const prize = await db.query.prizes.findFirst({ where: eq(prizes.id, prizeId) });
    if (!prize) return null;

    // The event the report's "วันที่เข้าร่วมกิจกรรม" column refers to: prefer the
    // eligibility event (the activity actually being evidenced), else whichever
    // event the prize is attached to. May be neither — a pure standing giveaway
    // has no event at all, and then the column is simply blank.
    const contextEventId = prize.eligibilityEventId ?? prize.eventId ?? null;

    const awarder = alias(users, "awarder");

    // MUST be pre-aggregated, not joined directly: `attendance` is unique per
    // (session, student), so a multi-day event holds one row PER DAY per
    // student. Joining it raw would emit one report line per day attended —
    // the same winner listed three times for a three-day event, in a document
    // whose whole job is being an accurate count of who received what.
    // min(checkInTime) = the day they first showed up.
    const attended = db
      .select({
        studentId: attendance.studentId,
        firstCheckIn: sql<Date | null>`min(${attendance.checkInTime})`.as("first_check_in"),
      })
      .from(attendance)
      .where(
        contextEventId
          ? and(eq(attendance.eventId, contextEventId), eq(attendance.status, "attended"))
          : sql`false`,
      )
      .groupBy(attendance.studentId)
      .as("attended");

    const rows = await db
      .select({
        claimId: prizeClaims.id,
        studentUserId: prizeClaims.studentId,
        name: users.name,
        nickname: users.nickname,
        studentId: users.studentId,
        prizeName: prizeClaims.prizeName,
        claimedAt: prizeClaims.claimedAt,
        photoKey: prizeClaims.photoKey,
        note: prizeClaims.note,
        awardedByName: awarder.name,
        // The student's OWN first check-in, when there is a context event and
        // they attended it. Null otherwise — the renderer falls back to the
        // event's startTime, then to blank.
        attendedAt: attended.firstCheckIn,
      })
      .from(prizeClaims)
      .innerJoin(users, eq(users.id, prizeClaims.studentId))
      .leftJoin(awarder, eq(awarder.id, prizeClaims.claimedBy))
      .leftJoin(attended, eq(attended.studentId, prizeClaims.studentId))
      .where(eq(prizeClaims.prizeId, prizeId))
      .orderBy(prizeClaims.claimedAt);

    const contextEvent = contextEventId
      ? await db.query.events.findFirst({
          where: eq(events.id, contextEventId),
          columns: { id: true, title: true, startTime: true },
        })
      : null;

    return { prize, contextEvent, rows };
  }

  /** Prize list with claim + รอรูป counts for the /admin/prizes table. */
  static async listPrizes(filter?: { eventIds?: string[] }) {
    const where = filter?.eventIds
      ? filter.eventIds.length > 0
        ? inArray(prizes.eventId, filter.eventIds)
        : sql`false`
      : undefined;

    return await db
      .select({
        id: prizes.id,
        name: prizes.name,
        eventId: prizes.eventId,
        rank: prizes.rank,
        quantity: prizes.quantity,
        onePerStudent: prizes.onePerStudent,
        requireCheckIn: prizes.requireCheckIn,
        eligibilityEventId: prizes.eligibilityEventId,
        status: prizes.status,
        createdAt: prizes.createdAt,
        claimCount: sql<number>`count(${prizeClaims.id})::int`,
        awaitingPhotoCount: sql<number>`count(${prizeClaims.id}) filter (where ${prizeClaims.photoKey} is null)::int`,
      })
      .from(prizes)
      .leftJoin(prizeClaims, eq(prizeClaims.prizeId, prizes.id))
      .where(where)
      .groupBy(prizes.id)
      .orderBy(prizes.sortOrder, desc(prizes.createdAt));
  }

  /** Claims awaiting a photo, for the "รอรูป" follow-up list. */
  static async listAwaitingPhoto(prizeId: string) {
    return await db
      .select({
        claimId: prizeClaims.id,
        name: users.name,
        studentId: users.studentId,
        claimedAt: prizeClaims.claimedAt,
      })
      .from(prizeClaims)
      .innerJoin(users, eq(users.id, prizeClaims.studentId))
      .where(and(eq(prizeClaims.prizeId, prizeId), isNull(prizeClaims.photoKey)))
      .orderBy(prizeClaims.claimedAt);
  }

  /* ----------------------------------------------------------------------- */

  private static toClaimStudent(u: { id: string; name: string; nickname: string | null; studentId: string | null }): PrizeClaimStudent {
    return { id: u.id, name: u.name, nickname: u.nickname, studentId: u.studentId };
  }

  /**
   * The read-only half of a claim: closed? already claimed? eligible? Shared by
   * previewClaim and claim() so the booth preview and the actual write can never
   * disagree about the rules. The duplicate branch here is a courtesy for the
   * UI — the DB index is what actually guarantees it.
   */
  private static async evaluate(
    prize: PrizeEligibilityInput & { id: string; name: string; eligibilityEventId: string | null },
    student: PrizeClaimStudent,
  ): Promise<PrizeClaimResult> {
    if (!isPrizeOpen(prize)) {
      return { status: "prize_closed", student, error: "รางวัลนี้ปิดรับแล้ว" };
    }

    if (isDuplicateClaim(prize)) {
      const existing = await db.query.prizeClaims.findFirst({
        where: and(eq(prizeClaims.prizeId, prize.id), eq(prizeClaims.studentId, student.id)),
      });
      if (existing) return await PrizeService.alreadyClaimed(prize.id, student);
    }

    if (prize.requireCheckIn && prize.eligibilityEventId) {
      const attended = await db.query.attendance.findFirst({
        where: and(
          eq(attendance.studentId, student.id),
          eq(attendance.eventId, prize.eligibilityEventId),
          eq(attendance.status, "attended"),
        ),
      });
      if (!meetsCheckInRequirement(prize, !!attended)) {
        const ev = await db.query.events.findFirst({
          where: eq(events.id, prize.eligibilityEventId),
          columns: { title: true },
        });
        return {
          status: "not_eligible",
          student,
          requiredEventTitle: ev?.title ?? null,
          error: `ยังไม่ได้เช็คอินกิจกรรม${ev?.title ? ` "${ev.title}"` : ""}`,
        };
      }
    }

    return { status: "success", student };
  }

  private static async alreadyClaimed(prizeId: string, student: PrizeClaimStudent): Promise<PrizeClaimResult> {
    const awarder = alias(users, "awarder");
    const existing = await db
      .select({
        claimedAt: prizeClaims.claimedAt,
        claimedByName: awarder.name,
      })
      .from(prizeClaims)
      .leftJoin(awarder, eq(awarder.id, prizeClaims.claimedBy))
      .where(and(eq(prizeClaims.prizeId, prizeId), eq(prizeClaims.studentId, student.id)))
      .limit(1);

    return {
      status: "already_claimed",
      student,
      existingClaim: existing[0]
        ? { claimedAt: existing[0].claimedAt, claimedByName: existing[0].claimedByName }
        : undefined,
      error: "รับรางวัลนี้ไปแล้ว",
    };
  }

  private static isUniqueViolation(e: unknown): boolean {
    // Drizzle surfaces the driver error either directly or wrapped in `cause`.
    const code = (e as { code?: string })?.code
      ?? ((e as { cause?: { code?: string } })?.cause?.code);
    return code === PG_UNIQUE_VIOLATION;
  }
}
