// Who may triage Anonymous Feedback & Complaints submissions.
//
// Deliberately narrower than most admin areas' full-admin set (admin-access.ts's
// FULL_ADMIN_ROLES also includes registration/organizer): those roles can
// themselves be the subject of a Staff Conduct or Harassment complaint, so
// widening visibility here directly undermines the anonymity guarantee in a
// way it doesn't for, say, the shop or event modules. See
// docs/features/feedback-complaints.md §6.
//
// Mirrors form-access.ts's FORM_MANAGER_ROLES pattern (a small dedicated
// roles list + predicate) rather than folding into admin-access.ts, since
// this is a feature-specific rule, not part of the who-may-enter-admin-at-all
// gating admin-access.ts is the source of truth for.
export const FEEDBACK_MANAGER_ROLES = ["super_admin", "admin"] as const;

export function isFeedbackManager(role?: string | null): boolean {
  return !!role && (FEEDBACK_MANAGER_ROLES as readonly string[]).includes(role);
}

// A user may hold several roles (users.roles[]) — gate on the whole set, same
// reason admin-access.ts's *Any predicates exist (a manager whose primary
// role isn't super_admin/admin must not be wrongly locked out).
export function isFeedbackManagerAny(roles: string[]): boolean {
  return roles.some(isFeedbackManager);
}
