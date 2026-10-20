// Students re-confirm their personal / medical / emergency info periodically.
// Pure helpers (no DB) so the client page and the tests can share them.

export const PROFILE_REVIEW_INTERVAL_MONTHS = 3;

/** Due when never reviewed, or the last review is at least the interval ago. */
export function isProfileReviewDue(
  reviewedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!reviewedAt) return true;
  const last = new Date(reviewedAt);
  if (Number.isNaN(last.getTime())) return true;
  const dueAt = new Date(last);
  dueAt.setMonth(dueAt.getMonth() + PROFILE_REVIEW_INTERVAL_MONTHS);
  return now >= dueAt;
}

/** The one trigger rule for the check-in modal: only completed profiles are asked. */
export function shouldShowProfileReview(
  user: { profileCompleted?: boolean | null; profileReviewedAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  return !!user?.profileCompleted && isProfileReviewDue(user.profileReviewedAt, now);
}
