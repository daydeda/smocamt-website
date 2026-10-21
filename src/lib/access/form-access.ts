// Shared rules for form scheduling (auto open/close window) and access control
// (who may see / fill a form). Used by both API routes and UI so the logic lives
// in exactly one place.

// Roles that can always manage AND fill any form, and are the ones who assign
// others. They never need to be explicitly assigned.
export const FORM_MANAGER_ROLES = ["super_admin", "admin"] as const;

// Roles an admin can assign a form to (by role). Mirrors the participant +
// staff roles used elsewhere in the app.
export const ASSIGNABLE_ROLES = [
  "organizer",
  "registration",
  "staff",
  "smo",
  "anusmo",
  "student",
] as const;

// Minimal shape these helpers need from a form row.
export interface FormAccessShape {
  formType: string;
  isActive: boolean | null;
  isAwarded: boolean | null;
  opensAt: string | Date | null;
  closesAt: string | Date | null;
  assignedRoles?: string[] | null;
  assignedUserIds?: string[] | null;
  // 'pending' | 'approved' — see forms.reviewStatus in schema.ts. Optional so
  // older call sites/tests that don't select it still type-check; treated as
  // 'approved' (no gate) when absent.
  reviewStatus?: string | null;
}

export interface FormUserShape {
  id?: string | null;
  role?: string | null;
}

export function isFormManager(role?: string | null): boolean {
  return !!role && (FORM_MANAGER_ROLES as readonly string[]).includes(role);
}

// Whether `role` may see a submission's respondent identity (name, student ID,
// nickname, major, phone, contact channels) on a form's submissions list.
// Managers (super_admin/admin) always see it, for audit/data-integrity reasons —
// everyone else (registration, organizer, and any future viewer role like smo/
// club_president/major_president) only sees it when the form creator opted in via
// `showRespondentIdentity`. Every form type defaults that flag to false so opening
// submissions access to more roles doesn't silently expose who said what; forms
// that genuinely need identity (e.g. registration-style collection) can turn it on.
//
// `reviewStatus`, when passed, closes a self-service loophole: a club_president/
// major_president may set showRespondentIdentity themselves (see POST/PATCH
// .../form), but that choice must never take effect until staff has actually
// reviewed it — otherwise a president could flip the flag on an already-
// submitted-to form and immediately see previously-anonymized respondents
// (including their own event's), fully bypassing the review step. While
// reviewStatus === 'pending', identity stays hidden for everyone except a
// manager, regardless of the flag's value. Omitted (undefined/null) is treated
// as no gate, for callers that haven't loaded the column.
export function canSeeRespondentIdentity(
  role: string | null | undefined,
  showRespondentIdentity: boolean | null | undefined,
  reviewStatus?: string | null
): boolean {
  if (isFormManager(role)) return true;
  if (reviewStatus === "pending") return false;
  return !!showRespondentIdentity;
}

// Whether `user` is allowed to see/fill the given S (Skill) form. Managers
// always qualify; otherwise the user's role must be assigned OR the user must be
// assigned by id. Empty assignment lists mean only managers can access.
export function canAccessSkillForm(form: FormAccessShape, user: FormUserShape | null | undefined): boolean {
  if (!user) return false;
  if (isFormManager(user.role)) return true;
  const roles = form.assignedRoles ?? [];
  const ids = form.assignedUserIds ?? [];
  if (user.role && roles.includes(user.role)) return true;
  if (user.id && ids.includes(user.id)) return true;
  return false;
}

export type FormAvailability = "awarded" | "pending_review" | "closed" | "upcoming" | "open";

// Effective submission state of a form. There is no manual open/close anymore:
// the schedule window (opensAt → closesAt) alone drives the lifecycle, plus the
// finalized flag (isAwarded) once the contest points have been auto-awarded.
//   - already awarded       → "awarded"
//   - a president's form still awaiting admin/registration review → "pending_review"
//     (visible to participants, but never submittable — same as "closed"; see
//     forms.reviewStatus in schema.ts. Checked before the schedule window so a
//     pending form never reads as "open" just because its window has started.)
//   - before opensAt        → "upcoming"
//   - after closesAt        → "closed" (will auto-award; then "awarded")
//   - otherwise             → "open"
// A null opensAt means "open immediately"; a null closesAt means "never closes".
export function getFormAvailability(form: FormAccessShape, now: Date = new Date()): FormAvailability {
  if (form.isAwarded) return "awarded";
  if (form.reviewStatus === "pending") return "pending_review";
  if (form.opensAt && now < new Date(form.opensAt)) return "upcoming";
  if (form.closesAt && now > new Date(form.closesAt)) return "closed";
  return "open";
}

export function isFormOpenForSubmission(form: FormAccessShape, now: Date = new Date()): boolean {
  return getFormAvailability(form, now) === "open";
}
