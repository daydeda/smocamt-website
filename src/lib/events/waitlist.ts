// Event waitlist: pure promotion logic. When a registered student cancels, the
// queue is walked in join order and each waiting student who still fits the
// event's overall quota AND their own cohort quota (Thai / international) is given
// a seat. See EventRegistrationService.promoteFromWaitlist for the locked DB side.

export type Cohort = "thai" | "intl";

/**
 * Cohort from a CMU student id, mirroring the register route: the third-from-last
 * digit "5" marks an international student; anything else (or a short/empty id)
 * counts as Thai.
 */
export function cohortOf(studentId: string | null | undefined): Cohort {
  const clean = (studentId ?? "").trim();
  return clean.length >= 3 && clean.slice(-3)[0] === "5" ? "intl" : "thai";
}

/** Seats left under a quota; null means unlimited (quota unset or 0). */
export function seatsLeft(quota: number | null | undefined, taken: number): number | null {
  if (quota == null || quota <= 0) return null;
  return Math.max(0, quota - taken);
}

export type WaitlistCandidate = { userId: string; cohort: Cohort };
export type SeatRoom = { overall: number | null; thai: number | null; intl: number | null };

/**
 * The candidates to promote, in queue order. A candidate whose cohort is full is
 * skipped (they keep their place) so a later candidate from the other cohort can
 * still take a free seat. Stops as soon as no overall seat is left.
 */
export function pickPromotions(queue: WaitlistCandidate[], room: SeatRoom): string[] {
  let overall = room.overall;
  const cohortRoom: Record<Cohort, number | null> = { thai: room.thai, intl: room.intl };
  const picked: string[] = [];
  for (const c of queue) {
    if (overall !== null && overall <= 0) break;
    const left = cohortRoom[c.cohort];
    if (left !== null && left <= 0) continue;
    picked.push(c.userId);
    if (overall !== null) overall -= 1;
    if (left !== null) cohortRoom[c.cohort] = left - 1;
  }
  return picked;
}

/** 1-based queue position of each of `userId`'s entries, from all entries of those events in join order. */
export function waitlistPositions(
  entries: { eventId: string; studentId: string }[],
  userId: string,
): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const e of entries) {
    const n = (seen.get(e.eventId) ?? 0) + 1;
    seen.set(e.eventId, n);
    if (e.studentId === userId) out.set(e.eventId, n);
  }
  return out;
}
