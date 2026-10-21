// No-show strike-out constants. See docs/agile/01-product-backlog.md
// (US-STRI-15a/b/c) for the underlying design.

// Individual points deducted from a student per confirmed no-show. This is the
// default pre-filled in the apply-strikes UI; staff with APPLY_STRIKES_ROLES
// may override it per application, bounded by NO_SHOW_PENALTY_MIN/MAX.
export const NO_SHOW_PENALTY_POINTS = 10;
export const NO_SHOW_PENALTY_MIN = 1;
export const NO_SHOW_PENALTY_MAX = 50;

// noShowCount at which users.registrationBlocked is set — pre-registration for
// new events is refused until a super_admin/admin resets the student's strikes.
export const NO_SHOW_STRIKE_THRESHOLD = 3;

// Roles allowed to confirm/apply no-show strikes for an event (organizers run
// their own events; registration is unscoped staff, like admin). smo may VIEW
// the roster/appeals queue but does not apply or resolve strikes.
// club_president/major_president are additionally scoped to events they own
// (see EventScopeService in apply-strikes/route.ts).
export const APPLY_STRIKES_ROLES = ["super_admin", "admin", "organizer", "registration", "club_president", "major_president"] as const;

// Roles allowed to reset a student's strikes/block ACCOUNT-WIDE (see
// /api/admin/students/[id]/strikes/reset) — narrower than apply, since a blanket
// reset erases the deterrent across every event and should be a deliberate staff
// decision. Distinct from RESOLVE_APPEALS_ROLES below, which only ever touches
// ONE appeal's event.
export const RESET_STRIKES_ROLES = ["super_admin", "admin"] as const;

// Roles allowed to VIEW the no-show appeals queue (/admin/appeals). Includes
// everyone in RESOLVE_APPEALS_ROLES plus smo, who may see appeal context for
// students they scan but cannot approve/reject (see RESOLVE_APPEALS_ROLES).
export const VIEW_APPEALS_ROLES = ["super_admin", "admin", "registration", "smo", "club_president", "major_president"] as const;

// Roles allowed to approve/reject a no-show appeal. club_president/major_president
// are further scoped server-side to appeals whose event they own (via
// EventScopeService, mirroring apply-strikes) — see PATCH
// /api/admin/appeals/[id]. smo can view the queue (VIEW_APPEALS_ROLES) but not
// resolve appeals, since resolving reverses a strike and touches noShowCount.
export const RESOLVE_APPEALS_ROLES = ["super_admin", "admin", "registration", "club_president", "major_president"] as const;
