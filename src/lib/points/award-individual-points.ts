import { db } from "@/db";
import { users, houses, scoreHistory } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Adds `points` individual points to one student's `users.points`, the shared core
 * behind every "individual points" award (event check-in via the scanner, and form
 * submission). Runs INSIDE the caller's transaction so the award commits together
 * with whatever triggered it (the attendance row / the form submission), and only
 * when the caller has confirmed the triggering action actually happened — that's what
 * keeps awards idempotent (a re-scan / re-submit that does nothing also awards
 * nothing).
 *
 * Side effects, mirroring the manual scanner "score" action:
 *  - increments users.points (COALESCE-guarded against a NULL balance),
 *  - writes a delta-0 score_history ledger row (so the award shows in the activity
 *    feed) when the student has a house,
 *  - fires the 100-point milestone house bonus (+2 house pts per 100 crossed).
 *
 * IMPORTANT: ledger rows are tagged with eventId ONLY, never formId — revertFormAward
 * claws back and DELETES every score_history row carrying a formId, so tagging these
 * would let a form re-open wrongly strip a student's permanent individual points and
 * milestone bonus. Individual points, once earned, are never clawed back.
 *
 * @returns the student's new total and any house points the milestone added.
 */
export async function awardIndividualPoints(
  tx: Tx,
  params: {
    studentId: string;
    studentName: string;
    houseId: string | null;
    eventId: string | null;
    points: number;
    /** Ledger reason for the award row, e.g. `Awarded 5 individual points to X for …`. */
    reason: string;
    /** Activity label used in the milestone ledger row, e.g. the event/form title. */
    activityLabel: string;
  }
): Promise<{ newPoints: number; housePointsAdded: number }> {
  const { studentId, studentName, houseId, eventId, points, reason, activityLabel } = params;
  if (!points || points <= 0) return { newPoints: 0, housePointsAdded: 0 };

  const [result] = await tx
    .update(users)
    .set({ points: sql`COALESCE(${users.points}, 0) + ${points}` })
    .where(eq(users.id, studentId))
    .returning({ newPoints: users.points });

  const newPoints = result?.newPoints ?? points;
  const previousPoints = newPoints - points;

  if (houseId) {
    await tx.insert(scoreHistory).values({
      houseId,
      eventId: eventId || null,
      delta: 0,
      reason,
    });
  }

  // 100-point milestone → +2 house points, identical rule to the manual score action.
  const milestoneDiff = Math.floor(newPoints / 100) - Math.floor(previousPoints / 100);
  let housePointsAdded = 0;
  if (milestoneDiff > 0 && houseId) {
    housePointsAdded = milestoneDiff * 2;
    await tx
      .update(houses)
      .set({ points: sql`${houses.points} + ${housePointsAdded}` })
      .where(eq(houses.id, houseId));
    await tx.insert(scoreHistory).values({
      houseId,
      eventId: eventId || null,
      delta: housePointsAdded,
      reason: `Student ${studentName} reached 100 point milestone (+${newPoints} total points) from activity "${activityLabel}"`,
    });
  }

  return { newPoints, housePointsAdded };
}

/**
 * Subtracts `points` individual points from one student's `users.points`. May
 * push the balance negative (matching houses.points, which has never floored
 * at 0) — a strikeout applied to a student already at/near 0 should actually
 * cost them, not silently no-op. Runs INSIDE the caller's transaction. Unlike
 * `awardIndividualPoints`, this never touches the 100-point milestone house bonus:
 * a no-show penalty should not claw back a house reward the student already earned
 * from a separate, real attendance.
 *
 * @returns the student's new total.
 */
export async function deductIndividualPoints(
  tx: Tx,
  params: {
    studentId: string;
    houseId: string | null;
    eventId: string | null;
    points: number;
    /** Ledger reason for the deduction row, e.g. `Deducted 10 points from X for no-show at …`. */
    reason: string;
  }
): Promise<{ newPoints: number }> {
  const { studentId, houseId, eventId, points, reason } = params;
  if (!points || points <= 0) return { newPoints: 0 };

  const [result] = await tx
    .update(users)
    .set({ points: sql`COALESCE(${users.points}, 0) - ${points}` })
    .where(eq(users.id, studentId))
    .returning({ newPoints: users.points });

  const newPoints = result?.newPoints ?? 0;

  if (houseId) {
    await tx.insert(scoreHistory).values({
      houseId,
      eventId: eventId || null,
      delta: 0,
      reason,
    });
  }

  return { newPoints };
}
