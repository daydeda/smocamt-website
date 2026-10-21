// Types, constants and small pure helpers for admin/events/page.tsx.
// Moved out of the page so the page file only holds the component.

import { eventYearFields, getAllowedEventYears } from "@/lib/access/event-access";

export interface AdminEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  registrationOpenTime: string | null;
  registrationCloseTime: string | null;
  quota: number | null;
  pointsAwarded: number;
  individualPointsAwarded: number;
  imageUrl: string | null;
  imageUrls: string[] | null;
  walkInsEnabled: boolean;
  walkInsOnly: boolean;
  quotaWalkIn: number | null;
  targetThai: boolean;
  targetInternational: boolean;
  quotaThai: number | null;
  quotaInternational: number | null;
  allowedRoles: string[] | null;
  allowedMajors: string[] | null;
  allowedClubs: string[] | null;
  firstYearOnly: boolean;
  allowedYears: number[] | null;
  managedByRoles: string[] | null;
  ownerClubIds: string[] | null;
  ownerMajors: string[] | null;
  // Specific user IDs assigned as staff for THIS event (as opposed to global
  // role) — their attendance is exempt from quota/no-show. See schema.ts.
  staffUserIds: string[] | null;
  // "Also count for Songsue" staff toggle — see events.songsueLinked in schema.ts.
  songsueLinked: boolean;
  // Hold-and-diff for president edits — a president's PUT never touches the
  // live fields above; it's stored here until staff approve or discard it.
  // See events.detailsReviewStatus/pendingDetailsChanges in schema.ts.
  detailsReviewStatus?: "pending" | "approved";
  detailsReviewedBy?: string | null;
  detailsReviewedAt?: string | null;
  pendingDetailsChanges?: Record<string, unknown> | null;
  pendingDetailsSubmittedBy?: string | null;
  pendingDetailsSubmittedAt?: string | null;
  pendingSubmitter?: { id: string; name: string } | null;
  registrationMode?: "once" | "per_session";
  // 'qr' (default) = scanner/manual/walk-in. 'evidence' = students self-submit
  // proof instead of being scanned — see events.checkInMode in schema.ts.
  checkInMode?: "qr" | "evidence";
  // Two-step QR check-in/check-out — see events.requireCheckOut in schema.ts.
  requireCheckOut?: boolean;
  // Sub-option of requireCheckOut — see events.checkOutEvidenceRequired in schema.ts.
  checkOutEvidenceRequired?: boolean;
  sessions?: EventSession[];
  attendeeCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

// A check-in day / session within an event. Returned by GET /api/admin/events
// and reconciled by id on PUT (existing updated, new inserted, missing deleted
// unless they have attendance). See the PUT handler in src/app/api/admin/events/[id]/route.ts for the backend contract.
export interface EventSession {
  id: string;
  title: string | null;
  startTime: string;
  endTime: string;
  sortOrder: number;
  quotaWalkIn: number | null;
  // Only meaningful when the parent event's checkInMode is 'evidence' — see
  // eventSessions.evidenceNonce/evidencePrompt in schema.ts.
  evidenceNonce?: string | null;
  evidencePrompt?: string | null;
}

// Editable session row held in form state. `id` is present only for sessions
// that already exist server-side (so PUT updates rather than recreates them);
// new rows omit it. start/end are datetime-local strings, converted to ISO on
// submit (same pattern as the event's own start/end).
export type SessionRow = {
  id?: string;
  title: string;
  startTime: string;
  endTime: string;
  quotaWalkIn: number | null;
  evidenceNonce: string | null;
  evidencePrompt: string | null;
};

// Field -> label/formatter table for the staff pending-changes diff banner
// (see events.pendingDetailsChanges in schema.ts). One entry per field a
// president can propose changes to — add an entry here if the server's
// PRESIDENT_EDITABLE_FIELDS (PUT /api/admin/events/[id]) ever grows.
export type PendingDiffRow = { key: string; label: string; oldText: string; newText: string };

export function formatPendingDetailsDiff(
  pending: Record<string, unknown>,
  current: AdminEvent,
  t: Record<string, string>
): PendingDiffRow[] {
  const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleString("en-GB") : "—");
  const fmtBool = (v: unknown) => (v ? "✓" : "—");
  const fmtText = (v: unknown) => {
    const s = (v as string | null | undefined)?.trim();
    return s ? s : "—";
  };
  const fmtNumber = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
  const fmtImages = (v: unknown) => {
    const n = Array.isArray(v) ? v.length : 0;
    return `${n} ${n === 1 ? "image" : "images"}`;
  };
  const fmtSessions = (v: unknown) => {
    const n = Array.isArray(v) ? v.length : 0;
    return `${n} ${n === 1 ? "session" : "sessions"}`;
  };
  const fmtMode = (v: unknown) =>
    v === "per_session" ? (t.registrationModePerSession || "Per-session") : (t.registrationModeOnce || "Once");

  const fields: { key: string; label: string; fmt: (v: unknown) => string }[] = [
    { key: "title", label: t.eventTitleLabel || "Title", fmt: fmtText },
    { key: "description", label: t.eventDescriptionLabel || "Description", fmt: fmtText },
    { key: "startTime", label: t.eventStartTimeLabel || "Start", fmt: fmtDate },
    { key: "endTime", label: t.eventEndTimeLabel || "End", fmt: fmtDate },
    { key: "registrationOpenTime", label: t.eventRegistrationOpenLabel || "Registration opens", fmt: fmtDate },
    { key: "registrationCloseTime", label: t.eventRegistrationCloseLabel || "Registration closes", fmt: fmtDate },
    { key: "quota", label: t.eventQuotaLabel || "Quota", fmt: fmtNumber },
    { key: "location", label: t.eventLocationLabel || "Location", fmt: fmtText },
    { key: "imageUrls", label: t.eventPosterLabel || "Poster", fmt: fmtImages },
    { key: "walkInsEnabled", label: t.allowWalkins || "Allow walk-ins", fmt: fmtBool },
    { key: "walkInsOnly", label: t.walkInsOnlyToggleLabel || "Walk-ins only", fmt: fmtBool },
    { key: "quotaWalkIn", label: t.walkInQuota || "Walk-in quota", fmt: fmtNumber },
    { key: "registrationMode", label: t.registrationModeLabel || "Registration mode", fmt: fmtMode },
    { key: "sessions", label: t.eventPendingDiffSessionsLabel || "Sessions", fmt: fmtSessions },
    { key: "targetThai", label: t.thaiStudents || "Thai students", fmt: fmtBool },
    { key: "targetInternational", label: t.internationalStudents || "International students", fmt: fmtBool },
    { key: "quotaThai", label: t.thaiStudentQuota || "Thai quota", fmt: fmtNumber },
    { key: "quotaInternational", label: t.intlStudentQuota || "International quota", fmt: fmtNumber },
    { key: "allowedYears", label: t.allowedStudentYears, fmt: (v) =>
      Array.isArray(v) && v.length ? v.map((year) => t.studentYearLabel.replace("{year}", String(year))).join(", ") : t.allStudentYears },
  ];

  const rows: PendingDiffRow[] = [];
  const normalizedPending: Record<string, unknown> = { ...pending, ...eventYearFields(pending) };
  for (const f of fields) {
    if (!(f.key in normalizedPending)) continue;
    const oldVal = f.key === "allowedYears" ? getAllowedEventYears(current) : (current as unknown as Record<string, unknown>)[f.key];
    const oldText = f.fmt(oldVal);
    const newText = f.fmt(normalizedPending[f.key]);
    if (oldText === newText) continue;
    rows.push({ key: f.key, label: f.label, oldText, newText });
  }
  return rows;
}

export interface EmergencyContact {
  // Absent (not just empty) when the server redacted it — the president tier
  // (api/admin/events/[id]/attendance, .../export) never sends the contact's
  // own name, only relationship + phone (see src/lib/emergency-contacts.ts).
  name?: string;
  relationship: string;
  phone: string;
}

export interface AdminStudent {
  id: string;
  name: string;
  nickname: string | null;
  studentId: string | null;
  email: string;
  phone: string | null;
  major: string | null;
  role: string | null;
  roles: string[] | null;
  religion: string | null;
  contactChannels: string | null;
  chronicDiseases: string | null;
  medicalHistory: string | null;
  drugAllergies: string | null;
  foodAllergies: string | null;
  dietaryRestrictions: string | null;
  faintingHistory: boolean | null;
  emergencyMedication: string | null;
  emergencyContacts: EmergencyContact[];
  houseId: string | null;
  house: { id: string; name: string; color: string } | null;
  // Server-derived "has a medical condition" signal. Sent to all admin-area
  // roles; the raw medical detail above is only populated for super_admin/admin.
  hasMedicalInfo?: boolean;
  // For non-admins: the medical categories the student filled in, as i18n keys
  // (e.g. "drugAllergies"), with no values — so they see what kind of condition
  // exists but not the detail.
  medicalCategories?: string[];
  // Account-wide no-show strike count (not PDPA-sensitive), sent to every
  // admin-area role that reaches the roster — powers the "Strike History"
  // filter, visible down to smo/president thin-roster views.
  noShowCount?: number;
}

export interface AdminAttendance {
  id: string;
  eventId: string;
  studentId: string;
  checkInTime: string | null;
  method: string | null;
  status: string;
  scannedBy: string | null;
  medsCheckOption: string | null;
  // Snapshot at insert time: was this person on the event's staffUserIds list
  // when they registered/checked in. See attendance.isStaff in schema.ts.
  isStaff: boolean;
  // Which day/session this row belongs to — present for multi-day events so the
  // roster can be filtered/exported per day (the same person attending Day 1 and
  // Day 2 yields two rows that differ only by this).
  session?: { id: string; title: string | null; sortOrder: number } | null;
  user?: AdminStudent;
}

// Role priority (mirrors ROLE_PRIORITY in src/auth.ts). A person's "primary"
// role is the highest-priority role they hold; "student" is the lowest, so an
// attendee counts as a regular student only when they hold no elevated role
// (smo, anusmo, registration, organizer, staff, office, etc.).
export const ROLE_PRIORITY = ["super_admin", "admin", "registration", "organizer", "smo", "anusmo", "club_president", "major_president", "staff", "professor", "officer", "student"];

export const isRegularStudent = (user: AdminStudent | null | undefined): boolean => {
  if (!user) return false;
  const roles = (user.roles && user.roles.length > 0)
    ? user.roles
    : (user.role ? [user.role] : ["student"]);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? "student";
  return primary === "student";
};

// Human label for a person's primary (highest-priority) role — used on the
// Staff roster section so each card shows *which* elevated role they hold,
// not just that they're not a regular student.
export const PRIMARY_ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  registration: "Registration",
  organizer: "Organizer",
  smo: "SMO",
  anusmo: "ANUSMO",
  club_president: "Club President",
  major_president: "Major President",
  staff: "Staff",
  professor: "Professor",
  officer: "Officer",
  student: "Student",
};

export const primaryRoleLabel = (user: AdminStudent | null | undefined): string => {
  if (!user) return "Staff";
  const roles = (user.roles && user.roles.length > 0)
    ? user.roles
    : (user.role ? [user.role] : ["student"]);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? "student";
  return PRIMARY_ROLE_LABELS[primary] || primary;
};

export const ALL_PARTICIPANT_ROLES = ["student", "staff", "smo", "anusmo", "club_president", "major_president"] as const;
export type ParticipantRole = typeof ALL_PARTICIPANT_ROLES[number];

export const ROLE_LABELS: Record<ParticipantRole, string> = {
  student: "Student",
  staff: "Staff",
  smo: "SMO",
  anusmo: "ANUSMO",
  club_president: "Club President",
  major_president: "Major President",
};

// Student majors that an event's registration can be restricted to. Includes
// postgraduate majors (KIM, DTM) added for Master's/Ph.D. targeting.
export const ALL_MAJORS = ["ANI", "DG", "DII", "MMIT", "SE", "KIM", "DTM"] as const;
// KIM (Master's) and DTM (Ph.D.) are the postgraduate majors — used to power
// the separate "Master's Degree" and "Ph.D Degree" attendance roster filters.
export const MASTER_MAJORS: string[] = ["KIM"];
export const PHD_MAJORS: string[] = ["DTM"];
export const MAJOR_LABELS: Record<string, string> = {
  ANI: "ANI - Animation & Visual Effects",
  DG: "DG - Digital Game",
  DII: "DII - Digital Industry Integration",
  MMIT: "MMIT - Modern Management & IT",
  SE: "SE - Software Engineering",
  KIM: "KIM",
  DTM: "DTM",
};

export const EMPTY_FORM = {
  title: "",
  description: "",
  location: "",
  startTime: "",
  endTime: "",
  registrationOpenTime: "",
  registrationCloseTime: "",
  quota: 0,
  pointsAwarded: 0,
  individualPointsAwarded: 0,
  imageUrl: "",
  imageUrls: [] as string[],
  walkInsEnabled: false,
  walkInsOnly: false, // true = no pre-registration accepted at all, see api/events/[id]/register
  quotaWalkIn: null as number | null,
  targetThai: true,
  targetInternational: true,
  quotaThai: null as number | null,
  quotaInternational: null as number | null,
  allowedRoles: [] as string[], // empty = all roles allowed
  allowedMajors: [] as string[], // empty = all majors allowed
  allowedClubs: [] as string[], // empty = no club restriction (open to everyone, subject to other filters)
  allowedYears: [] as number[], // Empty = all years; any selected year qualifies
  managedByRoles: [] as string[], // president role(s) that manage this event; empty = none
  ownerClubIds: [] as string[], // WHICH club(s) own this event, when managedByRoles includes club_president
  ownerMajors: [] as string[], // WHICH major(s) own this event, when managedByRoles includes major_president
  staffUserIds: [] as string[], // specific people assigned as staff for this event; empty = none
  songsueLinked: false, // staff-only "also count for Songsue" mirror toggle
  checkInMode: "qr" as "qr" | "evidence", // 'evidence' = students self-submit proof instead of scanning, see events.checkInMode
  requireCheckOut: false, // two-step QR check-in/check-out, see events.requireCheckOut
  checkOutEvidenceRequired: true, // sub-option of requireCheckOut, see events.checkOutEvidenceRequired
  // Hold-and-diff for president edits — see events.detailsReviewStatus/
  // pendingDetailsChanges in schema.ts. A brand new event (not yet saved) has
  // no pending edit, so this only matters once an existing event is loaded.
  detailsReviewStatus: "pending" as "pending" | "approved",
  detailsReviewedAt: null as string | null,
};
