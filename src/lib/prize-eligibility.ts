// Pure predicates for prize claiming (การรับรางวัล) — see
// docs/features/prize-claim.md. Deliberately DB-free so Vitest can cover them
// (`npm test` runs pure logic only; routes/UI are covered by /verify instead).
//
// These answer "should this claim be allowed?" for the booth preview screen.
// They are NOT the guarantee: the (prize_id, student_id) partial unique index on
// prize_claims is. A predicate that reads-then-writes loses the race when two
// staffers scan the same student on two phones in the same second, so
// PrizeService lets the insert fail and translates the unique violation. Keep
// that ordering in mind before "simplifying" either side away.

export interface PrizeEligibilityInput {
  status: "open" | "closed";
  onePerStudent: boolean;
  requireCheckIn: boolean;
  eligibilityEventId: string | null;
}

/** A closed prize accepts no new claims (but keeps every existing one). */
export function isPrizeOpen(prize: Pick<PrizeEligibilityInput, "status">): boolean {
  return prize.status === "open";
}

/**
 * Does this prize need a "has this student already got one?" lookup at all?
 * False for a prize that may legitimately repeat, which is also exactly when the
 * partial unique index does not apply — the two must agree or the UI would warn
 * about a duplicate the database is happy to accept.
 */
export function isDuplicateClaim(prize: Pick<PrizeEligibilityInput, "onePerStudent">): boolean {
  return prize.onePerStudent;
}

/**
 * Check-in requirement. Note the deliberate asymmetry: `requireCheckIn` with NO
 * `eligibilityEventId` passes rather than blocking everyone. A half-configured
 * prize should not silently refuse every student at the booth with a reason
 * staff can't act on — the configuration UI is where that gets caught.
 */
export function meetsCheckInRequirement(
  prize: Pick<PrizeEligibilityInput, "requireCheckIn" | "eligibilityEventId">,
  hasAttended: boolean,
): boolean {
  if (!prize.requireCheckIn) return true;
  if (!prize.eligibilityEventId) return true;
  return hasAttended;
}

/**
 * Whether the claim count has passed the configured target. SOFT — the caller
 * warns, it never blocks: real events over-award (a tie, an extra sponsor
 * prize), and a hard block at the booth makes staff stop RECORDING rather than
 * stop awarding, which would switch the duplicate check off too.
 */
export function isOverQuantity(prize: { quantity: number | null }, claimCount: number): boolean {
  return prize.quantity !== null && claimCount >= prize.quantity;
}
