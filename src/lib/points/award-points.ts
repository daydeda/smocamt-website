import { db } from "@/db";
import { events, attendance, scoreHistory, houses, forms } from "@/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { revalidateLeaderboards } from "@/lib/points/leaderboard-cache";

// Arbitrary constant key for the Postgres advisory lock that serialises award
// runs across all serverless instances. Any fixed integer works.
const AWARD_LOCK_KEY = 728193;
// A distinct lock key for the form-contest award run, so it can proceed
// independently of the event-winner run without the two blocking each other.
const FORM_AWARD_LOCK_KEY = 728194;

/**
 * Awards the event-winner bonus to the house with the most attendees for every
 * event that has ended and not yet been processed.
 *
 * Safe to call frequently (e.g. on each admin dashboard poll):
 *
 *  - Fast path: a single indexed query checks whether any ended event still lacks
 *    a score_history row. In steady state this returns nothing and we exit
 *    immediately — no transaction, no locks, negligible cost.
 *
 *  - When an event has just ended, we open ONE transaction and grab a
 *    transaction-scoped advisory lock. Only one instance can hold it at a time, so
 *    concurrent callers skip instantly instead of fighting over the `houses` rows
 *    (the old behaviour deadlocked under `max: 1`). The lock releases automatically
 *    when the transaction commits.
 *
 * Never throws — failures are logged and swallowed so callers can fire it safely.
 */
export async function checkAndAwardPastEventPoints() {
  try {
    const now = new Date();

    // Fast path: is there any ended event whose winner bonus hasn't been awarded?
    // `winnerAwardedAt` is the ONLY signal for "already processed" — we must not
    // infer it from score_history, because mid-event individual-score, milestone,
    // and manual-adjustment rows also carry this eventId and would falsely mark the
    // event as done, silently skipping the house winner bonus.
    const pending = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          lte(events.endTime, now),
          sql`${events.winnerAwardedAt} IS NULL`
        )
      )
      .limit(1);

    if (pending.length === 0) return; // nothing to award — cheap exit

    // Work exists: serialise across instances with a non-blocking advisory lock.
    await db.transaction(async (tx) => {
      // Cap how long any statement here waits on a row lock, so a concurrent
      // check-in write can't make the award block. We deliberately do NOT set
      // statement_timeout: over the Supabase transaction pooler that GUC can bleed
      // onto a reused backend and cancel unrelated queries (it was the only thing
      // in the codebase that could produce the 57014 statement-timeout errors).
      // Runaway duration is instead bounded by the award endpoint's maxDuration.
      await tx.execute(sql`SET LOCAL lock_timeout = '4000ms'`);

      const lockResult = await tx.execute<{ locked: unknown }>(
        sql`SELECT pg_try_advisory_xact_lock(${AWARD_LOCK_KEY}) AS locked`
      );
      const raw = lockResult[0]?.locked;
      const locked = raw === true || raw === "t" || raw === "true";
      if (!locked) return; // another instance is already processing these events

      // Re-fetch inside the lock so two racing callers can't both process an event.
      const pastEvents = await tx.query.events.findMany({
        where: and(lte(events.endTime, now), sql`${events.winnerAwardedAt} IS NULL`),
      });

      // Houses are stable across a single award run — fetch once and reuse, instead
      // of re-querying the table on every iteration of the per-event loop below.
      const dbHouses = await tx.query.houses.findMany();

      for (const event of pastEvents) {
        if (event.winnerAwardedAt) continue; // already processed

        // Isolate each event in its own SAVEPOINT so one poison event can't roll
        // back the whole batch — and thereby silently block EVERY other event's
        // winner bonus on every future run. The outer advisory lock still spans the
        // run (concurrent callers stay serialized); a failed event rolls back only
        // its own savepoint and we move on to the next. (continue → return: we're
        // inside the savepoint callback now, not the for-loop body.)
        try {
          await tx.transaction(async (tx2) => {
            const attendees = await tx2.query.attendance.findMany({
              where: and(
                eq(attendance.eventId, event.id),
                eq(attendance.status, "attended")
              ),
              with: { user: { columns: { houseId: true } } },
            });

            if (attendees.length === 0) {
              // No attendees — record a house-less activity row (houseId: null) so the
              // event still shows in the Recent Activity feed, but attributed to no house.
              // It used to be pinned to dbHouses[0], an arbitrary house, which made no sense.
              await tx2.insert(scoreHistory).values({
                houseId: null,
                eventId: event.id,
                delta: 0,
                reason: `Event "${event.title}" ended with no attendees. No points awarded.`,
              });
              await tx2.update(events).set({ winnerAwardedAt: new Date() }).where(eq(events.id, event.id));
              return;
            }

            // Count attendees grouped by house. The event-winner bonus is AGGREGATE
            // across sessions: a student who attends multiple days of a multi-day event
            // counts ONCE for their house (COUNT(DISTINCT student) per house), so the
            // bonus reflects distinct people, not raw check-in rows. For single-session
            // events this is identical to before. (Per-day winner scoring is a parked
            // decision — see docs/features/multi-day-points-policy.md.)
            const houseCounts: Record<string, { count: number; name: string; color: string }> = {};
            const houseMap = new Map(dbHouses.map((h) => [h.id, h]));
            const countedStudents = new Set<string>();

            for (const att of attendees) {
              const houseId = att.user?.houseId;
              if (!houseId) continue;
              if (countedStudents.has(att.studentId)) continue; // already counted on another day
              countedStudents.add(att.studentId);
              const houseObj = houseMap.get(houseId);
              if (!houseObj) continue;
              if (!houseCounts[houseId]) {
                houseCounts[houseId] = { count: 0, name: houseObj.name, color: houseObj.color ?? "" };
              }
              houseCounts[houseId].count++;
            }

            const houseList = Object.entries(houseCounts);
            if (houseList.length === 0) {
              // Everyone who checked in is unassigned to a house — record a house-less
              // activity row so it still shows in the feed, attributed to no house.
              await tx2.insert(scoreHistory).values({
                houseId: null,
                eventId: event.id,
                delta: 0,
                reason: `Event "${event.title}" ended but all checked-in students were unassigned. No points awarded.`,
              });
              await tx2.update(events).set({ winnerAwardedAt: new Date() }).where(eq(events.id, event.id));
              return;
            }

            // Winning house(s) — supports ties.
            let maxCount = -1;
            for (const [, data] of houseList) {
              if (data.count > maxCount) maxCount = data.count;
            }
            const winners = houseList.filter(([, data]) => data.count === maxCount);
            const pointsToAward = event.pointsAwarded ?? 0;

            // No points configured for this event (e.g. a survey/sign-up) → nothing
            // actually moves, so there's no winning house. Record a house-less activity
            // row (no "WINNER: X House" attribution, which would be meaningless at 0 pts).
            if (pointsToAward <= 0) {
              await tx2.insert(scoreHistory).values({
                houseId: null,
                eventId: event.id,
                delta: 0,
                reason: `Event "${event.title}" ended. No points awarded.`,
              });
              await tx2.update(events).set({ winnerAwardedAt: new Date() }).where(eq(events.id, event.id));
              return;
            }

            for (const [winnerHouseId, data] of winners) {
              await tx2
                .update(houses)
                .set({ points: sql`${houses.points} + ${pointsToAward}` })
                .where(eq(houses.id, winnerHouseId));

              const reasonStr = winners.length > 1
                ? `Event "${event.title}" completed! TIE WINNER: ${data.name} House won with ${data.count} attendees! Shared ${pointsToAward} PTS.`
                : `Event "${event.title}" completed! WINNER: ${data.name} House won with ${data.count} attendees! Received ${pointsToAward} PTS.`;

              await tx2.insert(scoreHistory).values({
                houseId: winnerHouseId,
                eventId: event.id,
                delta: pointsToAward,
                reason: reasonStr,
                timestamp: new Date(),
              });
            }

            // Mark processed so this event's winner bonus is never awarded twice.
            await tx2.update(events).set({ winnerAwardedAt: new Date() }).where(eq(events.id, event.id));
          });
        } catch (e) {
          // This event's savepoint rolled back; the rest of the batch still commits.
          console.error(`Failed to award winner bonus for event ${event.id}:`, e);
        }
      }
    });

    // Bust the cached leaderboard so a just-awarded event-winner bonus shows up on
    // the next poll instead of waiting out the cache TTL.
    revalidateLeaderboards();
  } catch (error) {
    console.error("Failed to automatically check and award past event points:", error);
  }
}

/**
 * Awards each evaluation form's contest points to the house that completed it the
 * most, as soon as the form's scheduled `closesAt` has passed. This replaces the
 * old manual "End & Award Points" button — there is no manual open/close anymore,
 * the schedule window alone drives the form lifecycle.
 *
 * Same cheap-by-default shape as checkAndAwardPastEventPoints:
 *
 *  - Fast path: one tiny query asks "is any form past closesAt and not yet
 *    awarded?". The forms table is small, so in steady state this returns nothing
 *    and we exit immediately — no transaction, no lock. Safe to call on hot reads.
 *
 *  - When a form has just closed, ONE transaction takes a transaction-scoped
 *    advisory lock (distinct key from the event run) so only one instance does the
 *    work. The `is_awarded = false` WHERE on the flip is the atomic gate: the
 *    loser of a race updates 0 rows and skips, so points can never be awarded twice.
 *
 * Never throws — failures are logged and swallowed so callers can fire it safely.
 */
export async function checkAndAwardClosedForms() {
  try {
    const now = new Date();

    // Fast path: any scheduled-closed form still awaiting its contest award?
    const pending = await db
      .select({ id: forms.id })
      .from(forms)
      .where(
        and(
          sql`${forms.closesAt} IS NOT NULL`,
          lte(forms.closesAt, now),
          eq(forms.isAwarded, false)
        )
      )
      .limit(1);

    if (pending.length === 0) return; // nothing to award — cheap exit

    await db.transaction(async (tx) => {
      // Bound row-lock waits without using statement_timeout (see the note in
      // checkAndAwardPastEventPoints for why statement_timeout is avoided here).
      await tx.execute(sql`SET LOCAL lock_timeout = '4000ms'`);

      const lockResult = await tx.execute<{ locked: unknown }>(
        sql`SELECT pg_try_advisory_xact_lock(${FORM_AWARD_LOCK_KEY}) AS locked`
      );
      const raw = lockResult[0]?.locked;
      const locked = raw === true || raw === "t" || raw === "true";
      if (!locked) return; // another instance is already processing closed forms

      // Re-fetch inside the lock, with the submissions + each submitter's house.
      const closedForms = await tx.query.forms.findMany({
        where: and(
          sql`${forms.closesAt} IS NOT NULL`,
          lte(forms.closesAt, now),
          eq(forms.isAwarded, false)
        ),
        with: {
          submissions: {
            with: { user: { columns: { houseId: true } } },
          },
        },
      });

      const dbHouses = await tx.query.houses.findMany();
      const houseNameMap = new Map(dbHouses.map((h) => [h.id, h.name]));

      for (const formObj of closedForms) {
        // Isolate each form in its own SAVEPOINT so one poison form can't roll back
        // the whole batch — and thereby silently block EVERY other closed form's
        // contest award on every future run. The outer advisory lock still spans the
        // run (concurrent callers stay serialized); a failed form rolls back only its
        // own savepoint (the flip + award commit or roll back together) and we move
        // on to the next. (continue → return: we're inside the savepoint callback
        // now, not the for-loop body — mirrors checkAndAwardPastEventPoints.)
        try {
          await tx.transaction(async (tx2) => {
            // Atomic gate: flip is_awarded only if still false. Also closes the form
            // (is_active=false) for tidiness. A racing run updates 0 rows and skips.
            const flipped = await tx2
              .update(forms)
              .set({ isActive: false, isAwarded: true, updatedAt: new Date() })
              .where(and(eq(forms.id, formObj.id), eq(forms.isAwarded, false)))
              .returning({ id: forms.id });

            if (flipped.length === 0) return; // someone else already awarded it

            // Count submissions per house (the contest metric: most completions wins).
            const houseCounts: Record<string, number> = {};
            for (const sub of formObj.submissions) {
              const houseId = sub.user?.houseId;
              if (!houseId) continue;
              houseCounts[houseId] = (houseCounts[houseId] || 0) + 1;
            }

            const houseList = Object.entries(houseCounts);
            if (houseList.length === 0) return; // closed with no eligible submissions

            const pointsToAward = formObj.pointsAwarded ?? 0;
            // No points configured for this form/survey (e.g. a shirt-order survey) → no
            // contest winner. Record a house-less activity row so it still shows in the
            // feed without naming a house. The form is already flagged is_awarded above.
            if (pointsToAward <= 0) {
              await tx2.insert(scoreHistory).values({
                houseId: null,
                eventId: formObj.eventId,
                formId: formObj.id,
                delta: 0,
                reason: `Evaluation form "${formObj.title}" closed. No points awarded.`,
              });
              return;
            }

            let maxSubmissions = -1;
            for (const [, count] of houseList) {
              if (count > maxSubmissions) maxSubmissions = count;
            }
            const winningHouseIds = houseList
              .filter(([, count]) => count === maxSubmissions)
              .map(([hId]) => hId);

            for (const winnerId of winningHouseIds) {
              const houseName = houseNameMap.get(winnerId) || winnerId;

              await tx2
                .update(houses)
                .set({ points: sql`${houses.points} + ${pointsToAward}` })
                .where(eq(houses.id, winnerId));

              const reasonStr =
                winningHouseIds.length > 1
                  ? `Event Form Contest Tie Winner: ${houseName} House completed the evaluation form "${formObj.title}" most with ${maxSubmissions} submissions! Shared ${pointsToAward} PTS.`
                  : `Event Form Contest Winner: ${houseName} House completed the evaluation form "${formObj.title}" most with ${maxSubmissions} submissions! Received ${pointsToAward} PTS.`;

              await tx2.insert(scoreHistory).values({
                houseId: winnerId,
                eventId: formObj.eventId,
                formId: formObj.id,
                delta: pointsToAward,
                reason: reasonStr,
                timestamp: new Date(),
              });
            }
          });
        } catch (e) {
          // This form's savepoint rolled back; the rest of the batch still commits.
          console.error(`Failed to award contest points for form ${formObj.id}:`, e);
        }
      }
    });

    // Bust the cached leaderboard so a just-awarded form-contest payout shows up on
    // the next poll instead of waiting out the cache TTL.
    revalidateLeaderboards();
  } catch (error) {
    console.error("Failed to automatically check and award closed form points:", error);
  }
}

// The transaction handle type, derived from db.transaction's callback, so the
// revert helper can run inside a caller-owned transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reverses a single form's contest award so the form can be re-opened.
 *
 * Sums the net points this form currently contributes per house (its award rows,
 * plus any earlier offsets that also carry this formId), subtracts that back out
 * of each house's running total, then deletes the form's score_history rows so
 * the void award stops cluttering the public Recent Activity feed. The staff
 * action itself is recorded separately in audit_logs by the caller.
 *
 * Tightly scoped by formId: event scans, manual adjustments, and the event-winner
 * bonus all share the same eventId but never carry a formId, so they are left
 * untouched. Idempotent — a second call finds no rows and is a no-op.
 *
 * Runs inside the CALLER's transaction (so the revert, the is_awarded flip, and
 * the audit log all commit or roll back together). Returns what was clawed back
 * per house for the audit message.
 */
export async function revertFormAward(
  tx: Tx,
  formId: string
): Promise<{ houseId: string; points: number }[]> {
  const rows = await tx
    .select({
      houseId: scoreHistory.houseId,
      // Cast to int: SUM() yields bigint, which the driver returns as a string.
      net: sql<number>`COALESCE(SUM(${scoreHistory.delta}), 0)::int`,
    })
    .from(scoreHistory)
    .where(eq(scoreHistory.formId, formId))
    .groupBy(scoreHistory.houseId);

  const reverted: { houseId: string; points: number }[] = [];
  for (const r of rows) {
    // House-less rows (e.g. a 0-point "form closed" marker) and zero-net houses
    // need no points adjustment — they're cleaned up by the delete below.
    if (r.houseId && r.net) {
      await tx
        .update(houses)
        .set({ points: sql`${houses.points} - ${r.net}` })
        .where(eq(houses.id, r.houseId));
      reverted.push({ houseId: r.houseId, points: r.net });
    }
  }

  // Scoped DELETE — only THIS form's ledger rows. The re-open makes them void;
  // the audit trail lives in audit_logs, not here.
  await tx.delete(scoreHistory).where(eq(scoreHistory.formId, formId));

  return reverted;
}
