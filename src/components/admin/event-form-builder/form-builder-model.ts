import { serializeForm, type FormSection } from "@/lib/forms/form-schema";

// Types, constants and helpers for EventFormBuilderModal.tsx.

export interface FormBuilderSubmission {
  id: string;
  studentName: string;
  studentId: string;
  houseId: string;
  nickname?: string;
  major?: string;
  phone?: string;
  contactChannels?: string;
  // Server-side masked (name/studentId/nickname/major/phone/contactChannels come
  // back empty) because the viewer isn't a super_admin/admin and this form's
  // showRespondentIdentity is off — see canSeeRespondentIdentity in form-access.ts.
  identityHidden?: boolean;
  answers: Record<string, string | number | string[]>;
  submittedAt: string;
  score?: number;
  maxScore?: number;
  hasGraded?: boolean;
}

export interface EventFormSummary {
  id: string;
  formType: string;
  sortOrder: number;
  title: string;
  description: string;
  questions: unknown;
  pointsAwarded: number;
  individualPointsAwarded: number;
  isActive: boolean;
  isAwarded: boolean;
  opensAt: string | null;
  closesAt: string | null;
  assignedRoles: string[];
  assignedUserIds: string[];
  showRespondentIdentity: boolean;
  stats: Record<string, number>;
  submissions: FormBuilderSubmission[];
  // Review gate for president-created forms — see forms.reviewStatus in
  // schema.ts. 'approved' for every staff-created form (no gate).
  reviewStatus: "pending" | "approved";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export const FORM_TYPE_LABELS: Record<string, string> = {
  K_pre: "K Pre-Test",
  K_post: "K Post-Test",
  A: "A - Attitude",
  S: "S - Skill",
  F: "F - Feedback",
};

// Roles an admin can assign an S (Skill) form to. Mirrors ASSIGNABLE_ROLES in
// src/lib/form-access.ts.
export const ASSIGNABLE_FORM_ROLES = ["organizer", "registration", "staff", "smo", "anusmo", "student"] as const;

export const ASSIGNABLE_ROLE_LABELS: Record<string, string> = {
  organizer: "Organizer",
  registration: "Registration",
  staff: "Staff",
  smo: "SMO",
  anusmo: "ANUSMO",
  student: "Student",
};

// Size a <textarea> to fit its content so typed/loaded line breaks are visible.
// Used as a ref callback (fires on mount + each render, so it also grows when an
// existing multi-line value is loaded into the editor) and from onChange. Without
// this a rows=1 textarea hides newlines off-screen, making line breaks look broken.
export const autoGrowTextarea = (el: HTMLTextAreaElement | null): void => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

// Convert a stored ISO timestamp to a value for a <input type="datetime-local">
// in the browser's local timezone (Bangkok for on-site admins), matching how
// event registration times are handled elsewhere on this page.
export const toDatetimeLocal = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

// Stable fingerprint of the form-builder's editable state, used to detect
// unsaved edits so we can warn before an accidental close / reload. Sections
// are run through serializeForm so the comparison matches exactly what gets
// persisted, and the assignment arrays are sorted so reordering alone never
// reads as a change.
export type BuilderState = {
  activeFormType: string;
  formTitle: string;
  formDescription: string;
  formPoints: number;
  formIndividualPoints: number;
  formSections: FormSection[];
  formIsAwarded: boolean;
  formOpensAt: string;
  formClosesAt: string;
  formAssignedRoles: string[];
  formAssignedUserIds: string[];
  formShowRespondentIdentity: boolean;
};

export const builderFingerprint = (f: BuilderState): string =>
  JSON.stringify([
    f.activeFormType, f.formTitle, f.formDescription, f.formPoints, f.formIndividualPoints,
    serializeForm(f.formSections), f.formIsAwarded, f.formOpensAt, f.formClosesAt,
    [...f.formAssignedRoles].sort(), [...f.formAssignedUserIds].sort(), f.formShowRespondentIdentity,
  ]);

export const FORM_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  K_pre:  { bg: "rgb(var(--indigo-500-rgb) / 0.12)",  text: "var(--indigo-500)", border: "rgb(var(--indigo-500-rgb) / 0.3)"  },
  K_post: { bg: "rgb(var(--emerald-500-rgb) / 0.12)",  text: "var(--emerald-500)", border: "rgb(var(--emerald-500-rgb) / 0.3)"  },
  A:      { bg: "rgb(var(--amber-500-rgb) / 0.12)",  text: "var(--amber-500)", border: "rgb(var(--amber-500-rgb) / 0.3)"  },
  S:      { bg: "rgb(var(--red-500-rgb) / 0.12)",   text: "var(--red-500)", border: "rgb(var(--red-500-rgb) / 0.3)"   },
  F:      { bg: "rgb(var(--cyan-500-rgb) / 0.12)",   text: "var(--cyan-500)", border: "rgb(var(--cyan-500-rgb) / 0.3)"   },
};

// Feedback-form builder for a single event, extracted out of
// admin/events/page.tsx so it can also be mounted directly on admin/clubs and
// admin/majors (club_president/major_president managing their own event's
// form without navigating away — see EventFeedbackFormsShortcut.tsx). Fully
// self-contained: derives its own permissions from the session (mirroring
// admin/events/page.tsx's isAttendanceOnly/canManageForms/canViewForms) and
// fetches its own forms, so it never depends on the caller's page state.
// eventId/eventTitle are fixed for the component's lifetime — mounting IS
// "open", unmounting (via onClose) IS "close"; there's no internal show/hide
// state left over from the original showFormBuilder flag.
export interface EventFormBuilderModalProps {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
  // Notifies the caller after a save/delete/review action succeeds, so a
  // parent list (e.g. the Feedback Forms shortcut) can refresh its own
  // per-event status summary.
  onChanged?: () => void;
}
