"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  Plus, Edit2, Trash2, Calendar, MapPin, Clock,
  User, Users, CheckCircle2, Search,
  Sparkles, X, ExternalLink,
  ChevronLeft, ChevronRight, AlertCircle, BarChart3, RefreshCw, Zap,
  Activity, Phone, HeartPulse, Info, Trophy, ClipboardList, Download, ShieldCheck,
  AlertTriangle, GraduationCap, DoorOpen, UserX, Building2
} from "lucide-react";
import { useSession } from "next-auth/react";
import { NO_SHOW_PENALTY_MAX, NO_SHOW_PENALTY_MIN, NO_SHOW_PENALTY_POINTS, NO_SHOW_STRIKE_THRESHOLD } from "@/lib/strikes";
import { parseRichText } from "@/lib/rich-text";
import { currentFirstYearPrefix, yearOfStudy } from "@/lib/event-access";
import { sessionSpansTooLong, splitIntoDailySessions } from "@/lib/event-schema";
import { useLanguage } from "@/lib/LanguageContext";
import { usePolling } from "@/lib/usePolling";
import { EventFormBuilderModal } from "@/components/admin/EventFormBuilderModal";
import { isGlobalRegistrationPosition } from "@/lib/admin-access";

interface AdminEvent {
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
  sessions?: EventSession[];
  attendeeCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

// A check-in day / session within an event. Returned by GET /api/admin/events
// and reconciled by id on PUT (existing updated, new inserted, missing deleted
// unless they have attendance). See backend contract in CLAUDE.md.
interface EventSession {
  id: string;
  title: string | null;
  startTime: string;
  endTime: string;
  sortOrder: number;
  quotaWalkIn: number | null;
}

// Editable session row held in form state. `id` is present only for sessions
// that already exist server-side (so PUT updates rather than recreates them);
// new rows omit it. start/end are datetime-local strings, converted to ISO on
// submit (same pattern as the event's own start/end).
type SessionRow = {
  id?: string;
  title: string;
  startTime: string;
  endTime: string;
  quotaWalkIn: number | null;
};

// Field -> label/formatter table for the staff pending-changes diff banner
// (see events.pendingDetailsChanges in schema.ts). One entry per field a
// president can propose changes to — add an entry here if the server's
// PRESIDENT_EDITABLE_FIELDS (PUT /api/admin/events/[id]) ever grows.
type PendingDiffRow = { key: string; label: string; oldText: string; newText: string };

function formatPendingDetailsDiff(
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
    { key: "firstYearOnly", label: t.firstYearOnly || "First-year only", fmt: fmtBool },
  ];

  const rows: PendingDiffRow[] = [];
  for (const f of fields) {
    if (!(f.key in pending)) continue;
    const oldVal = (current as unknown as Record<string, unknown>)[f.key];
    const oldText = f.fmt(oldVal);
    const newText = f.fmt(pending[f.key]);
    if (oldText === newText) continue;
    rows.push({ key: f.key, label: f.label, oldText, newText });
  }
  return rows;
}

interface EmergencyContact {
  // Absent (not just empty) when the server redacted it — the president tier
  // (api/admin/events/[id]/attendance, .../export) never sends the contact's
  // own name, only relationship + phone (see src/lib/emergency-contacts.ts).
  name?: string;
  relationship: string;
  phone: string;
}

interface AdminStudent {
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

interface AdminAttendance {
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
const ROLE_PRIORITY = ["super_admin", "admin", "registration", "organizer", "smo", "anusmo", "club_president", "major_president", "staff", "professor", "officer", "student"];

const isRegularStudent = (user: AdminStudent | null | undefined): boolean => {
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
const PRIMARY_ROLE_LABELS: Record<string, string> = {
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

const primaryRoleLabel = (user: AdminStudent | null | undefined): string => {
  if (!user) return "Staff";
  const roles = (user.roles && user.roles.length > 0)
    ? user.roles
    : (user.role ? [user.role] : ["student"]);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? "student";
  return PRIMARY_ROLE_LABELS[primary] || primary;
};

const ALL_PARTICIPANT_ROLES = ["student", "staff", "smo", "anusmo", "club_president", "major_president"] as const;
type ParticipantRole = typeof ALL_PARTICIPANT_ROLES[number];

const ROLE_LABELS: Record<ParticipantRole, string> = {
  student: "Student",
  staff: "Staff",
  smo: "SMO",
  anusmo: "ANUSMO",
  club_president: "Club President",
  major_president: "Major President",
};

// Student majors that an event's registration can be restricted to. Includes
// postgraduate majors (KIM, DTM) added for Master's/Ph.D. targeting.
const ALL_MAJORS = ["ANI", "DG", "DII", "MMIT", "SE", "KIM", "DTM"] as const;
// KIM (Master's) and DTM (Ph.D.) are the postgraduate majors — used to power
// the separate "Master's Degree" and "Ph.D Degree" attendance roster filters.
const MASTER_MAJORS: string[] = ["KIM"];
const PHD_MAJORS: string[] = ["DTM"];
const MAJOR_LABELS: Record<string, string> = {
  ANI: "ANI - Animation & Visual Effects",
  DG: "DG - Digital Game",
  DII: "DII - Digital Industry Integration",
  MMIT: "MMIT - Modern Management & IT",
  SE: "SE - Software Engineering",
  KIM: "KIM",
  DTM: "DTM",
};

const EMPTY_FORM = {
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
  firstYearOnly: false, // true = only the current first-year intake may join
  managedByRoles: [] as string[], // president role(s) that manage this event; empty = none
  ownerClubIds: [] as string[], // WHICH club(s) own this event, when managedByRoles includes club_president
  ownerMajors: [] as string[], // WHICH major(s) own this event, when managedByRoles includes major_president
  staffUserIds: [] as string[], // specific people assigned as staff for this event; empty = none
  songsueLinked: false, // staff-only "also count for Songsue" mirror toggle
  // Hold-and-diff for president edits — see events.detailsReviewStatus/
  // pendingDetailsChanges in schema.ts. A brand new event (not yet saved) has
  // no pending edit, so this only matters once an existing event is loaded.
  detailsReviewStatus: "pending" as "pending" | "approved",
  detailsReviewedAt: null as string | null,
};

export default function AdminEventsPage() {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  // The admin area also admits registration/organizer (see admin/layout.tsx),
  // but seeing medical detail in the exported file / student modal — which
  // includes PDPA-sensitive medical & emergency contact data — is restricted to
  // super_admin/admin, plus (2026-07-18) a club/major president viewing an
  // event THEY OWN, with the emergency contact's own name redacted server-side
  // for that tier — see canSeeRawMedicalDetail below.
  const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
  const canExportAttendance = myRoles.includes("super_admin") || myRoles.includes("admin");
  // A global registration position (smoPosition/anusmoPosition === "registration"
  // held by an smo/anusmo) gets the same full staff-tier breadth the "registration" ROLE
  // has on this page — mirrors every server-side gate this page talks to
  // (POST/PUT/DELETE /api/admin/events, .../form) via isGlobalRegistrationPosition.
  // Without this, such a user's role SET (["smo"]) never matches the
  // "registration" string below, so they'd be silently stuck on the thin,
  // view-only surface even though the server accepts their writes.
  const globalRegPosition = isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);
  // Scanner-only roles (smo, club_president, major_president) reach this page to
  // VIEW attendance only — no event create/edit/delete. Mirrors the thin-roster
  // gate in api/admin/events/[id]/attendance (a user with any staff role gets
  // the full page). Feedback forms are a separate, narrower carve-out — see
  // canManageForms/canViewForms below. Students never reach here (proxy blocks
  // them).
  const isAttendanceOnly = !globalRegPosition && !myRoles.some((r) =>
    ["super_admin", "admin", "registration", "organizer"].includes(r)
  );
  // The Export Excel button: staff export the full (role-gated) file; the
  // scanner-only student-leader roles (smo/club_president/major_president)
  // may also export, but the server (api/admin/events/[id]/export) hands them
  // a THIN file with no phone, meds-check, medical, or emergency-contact
  // columns — they must ask an admin/super_admin for that detail. Mirrors the
  // server's isThinExportRole exactly — deliberately NARROWER than
  // isAttendanceOnly, which also buckets in a plain club/major member whose
  // position TITLE happens to be "registration" (club_members.position, see
  // src/lib/positions.ts — cosmetic, not a system role) but who holds no
  // export-eligible role; the server already 403s that case, so the button
  // must not be shown for it either.
  const canSeeExportButton = canExportAttendance || myRoles.some((r) =>
    ["smo", "club_president", "major_president"].includes(r)
  );
  // No-show strike-out (US-STRI-15): organizers confirm no-shows for their own
  // ended events; registration is unscoped staff, like admin. smo may view the
  // roster but does NOT apply strikes. club_president/major_president are
  // additionally scoped server-side to events they own (see EventScopeService in
  // api/admin/events/[id]/apply-strikes) — the GET/POST list here already only
  // ever contains events they're allowed to see. Narrower than "reset strikes",
  // which is admin/super_admin only (see /api/admin/students/[id]/strikes/reset).
  const canApplyStrikes = myRoles.some((r) =>
    ["super_admin", "admin", "organizer", "registration", "club_president", "major_president"].includes(r)
  );
  // Club/major presidents may edit their OWN event's details (title, description,
  // schedule, location, quota, etc.) — GET /api/admin/events already scopes their
  // list to only events they own (see EventScopeService), so any event a president
  // sees here is theirs to edit. They still may NOT touch role/major access,
  // Managed By, or points — those stay staff-only (see canEditRestrictedFields
  // below and the matching server-side strip in PUT /api/admin/events/[id]).
  const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));
  const canEditEventDetails = !isAttendanceOnly || isPresidentRole;
  // Attendee Contact/Medical sections + filter, on the roster and in the
  // per-student detail modal: staff (registration/organizer included, thin
  // signal only) OR a president viewing an event they own — server-scoped via
  // GET /api/admin/events already only listing events they manage. smo stays
  // excluded (thin roster, no contact/medical data at all — see
  // api/admin/events/[id]/attendance).
  const canSeeAttendeeContactAndMedical = !isAttendanceOnly || isPresidentRole;
  // Raw medical TEXT (vs. the category-signal-only view registration/organizer
  // get): super_admin/admin, or a president viewing their own event — by
  // deliberate product decision (2026-07-18) mirroring the club/major
  // member-roster grant (see ClubsService.getClubMembers). The server
  // (api/admin/events/[id]/attendance, .../export) redacts the emergency
  // contact's own NAME for the president tier even so — audit log is the
  // accountability mechanism, not field-level gating.
  const canSeeRawMedicalDetail = canExportAttendance || isPresidentRole;
  // Feedback/evaluation forms: staff manage every event's forms unscoped;
  // club/major presidents may also fully manage (create/edit/delete) forms, but
  // only for events they own — the events list here is already scoped to just
  // their events (see canEditEventDetails above), so any event a president sees
  // is theirs to manage. smo gets read-only access to every event's forms (no
  // ownership scoping) — it may view the House Leaderboard & Submissions tab but
  // never create/edit/delete a form. Server-side gate is the real source of
  // truth (see gateEventForms in api/admin/events/[id]/form/route.ts).
  const isSmoRole = myRoles.includes("smo");
  const canManageForms = !isAttendanceOnly || isPresidentRole;
  const canViewForms = canManageForms || isSmoRole;
  // Role/major access control, Managed By (president/owner), and points are
  // admin/registration/organizer only — even for a president editing their own event.
  const canEditRestrictedFields = !isAttendanceOnly;
  // Removing a wrongly-registered student is admin/registration only — deliberately
  // NARROWER than canEditEventDetails (excludes organizer AND presidents). A
  // president removing a peer's registration is a bias/conflict-of-interest risk;
  // see the matching server-side gate in api/admin/events/[id]/attendance DELETE
  // (which also honors a global registration position the same way).
  const canRemoveRegistrant = globalRegPosition || myRoles.some((r) => ["super_admin", "admin", "registration"].includes(r));
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  // For the "Managed By" owner pickers below — which club(s) can be assigned as
  // an event's ownerClubIds. Fetched once; only staff (who can reach this page)
  // are allowed to call /api/admin/clubs anyway.
  const [clubs, setClubs] = useState<{ id: string; name: string; isArchived: boolean }[]>([]);
  // Multi-day / multi-session support. registrationMode is intentionally NOT
  // pre-selected (null) — a plain single-day event needs no choice. Picking
  // "once" (register once, attend any/all days) or "per_session" (each day
  // independent) reveals the Days/Sessions editor. When left null on submit we
  // send "once" and the sole seeded session (mirrored to the main start/end).
  // `sessions` always carries at least one row (the create/edit handlers seed it).
  const [registrationMode, setRegistrationMode] = useState<"once" | "per_session" | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Set when this create-form open was triggered by "Create Event from
  // Proposal" on /admin/proposals (see the ?fromProposal= effect below) — sent
  // back as eventSchema's proposalId so POST /api/admin/events can flip the
  // source proposal to 'approved' in the same transaction. Cleared whenever the
  // form closes/resets so it's never accidentally sent on an unrelated create.
  const [sourceProposalId, setSourceProposalId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingStudentId, setRemovingStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsReviewToggling, setDetailsReviewToggling] = useState(false);
  const [songsueResyncing, setSongsueResyncing] = useState(false);
  const [songsueResyncMessage, setSongsueResyncMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "live" | "upcoming" | "past">("all");

  // Attendance tracking
  const [showAttendance, setShowAttendance] = useState(false);
  const [attendance, setAttendance] = useState<AdminAttendance[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  // Guards against an earlier in-flight roster fetch resolving after a newer one
  // (opening event A then B must never render A's roster under B).
  const attendanceReqRef = useRef(0);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<AdminStudent | null>(null);
  const [filterMedical, setFilterMedical] = useState(false);
  const [filterNotCheckedIn, setFilterNotCheckedIn] = useState(false);
  // Two distinct no-show lenses (both visible to smo/president thin-roster
  // views — a strike count is not PDPA-sensitive): account-wide strike
  // history (noShowCount > 0, from any past event) vs. a no-show for THIS
  // event specifically (registered, never checked into any session of it —
  // mirrors findNoShowStudentIds in api/admin/events/[id]/apply-strikes).
  const [filterStrikeHistory, setFilterStrikeHistory] = useState(false);
  const [filterEventNoShow, setFilterEventNoShow] = useState(false);
  // No-show strike-out confirm flow: preview the roster, let the organizer
  // confirm, then apply. Kept separate from the attendance roster state above
  // since it's its own modal/request lifecycle.
  const [showStrikesModal, setShowStrikesModal] = useState(false);
  const [strikesPreview, setStrikesPreview] = useState<{ id: string; name: string; nickname: string | null; studentId: string | null; noShowCount: number }[]>([]);
  const [strikesLoading, setStrikesLoading] = useState(false);
  const [strikesSubmitting, setStrikesSubmitting] = useState(false);
  const [strikesResult, setStrikesResult] = useState<{ struck: number; blocked: number; pointsDeducted: number } | null>(null);
  // Editable per-application penalty, bounded server-side by NO_SHOW_PENALTY_MIN/MAX.
  const [strikesPoints, setStrikesPoints] = useState(NO_SHOW_PENALTY_POINTS);
  const [filterStudentsOnly, setFilterStudentsOnly] = useState(false);
  const [filterMaster, setFilterMaster] = useState(false);
  const [filterPhd, setFilterPhd] = useState(false);
  const [filterThai, setFilterThai] = useState(true);
  const [filterInternational, setFilterInternational] = useState(true);
  const [yearFilter, setYearFilter] = useState<Set<number>>(new Set()); // empty = all years
  // Per-day (session) filter for multi-day events. null = all days. Only shown
  // when the active event has more than one session.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Custom Form Builder states — the builder itself lives in
  // EventFormBuilderModal (see src/components/admin/EventFormBuilderModal.tsx),
  // extracted so admin/clubs and admin/majors can mount it too; this page just
  // tracks which event's builder (if any) is open.
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [formEventId, setFormEventId] = useState<string | null>(null);
  const [formEventTitle, setFormEventTitle] = useState<string | null>(null);
  const openFormBuilder = (id: string, title: string) => {
    setFormEventId(id);
    setFormEventTitle(title);
    setShowFormBuilder(true);
  };
  const [assigneeUsers, setAssigneeUsers] = useState<{ id: string; name: string | null; studentId: string | null; role: string | null }[]>([]);
  // Search box for the Event Staff picker. EventFormBuilderModal has its own
  // independent assigneeUsers/assigneeSearch for the S-form person-picker
  // (it's a standalone component now — see that file).
  const [staffAssigneeSearch, setStaffAssigneeSearch] = useState("");

  // Loads the people directory once (best-effort), shared by the S-form
  // assignee picker and the Event Staff picker.
  const ensureAssigneeUsersLoaded = () => {
    if (assigneeUsers.length > 0) return;
    fetch("/api/admin/students")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setAssigneeUsers(d.map((u) => ({ id: u.id, name: u.name, studentId: u.studentId, role: u.role }))); })
      .catch(() => {});
  };

  // Custom premium modals for confirmation and errors — confirmModal is used
  // by handleDelete/removeRegistrant below; EventFormBuilderModal has its own
  // independent copy for its unsaved-changes/reopen-award confirmations (it's
  // a standalone component, also mounted from admin/clubs & admin/majors).
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
  }>({
    show: false,
    title: "",
    message: "",
    onConfirm: () => {},
    confirmText: "",
    cancelText: "",
    isDanger: false
  });

  const [errorModal, setErrorModal] = useState<{
    show: boolean;
    title: string;
    message: string;
  }>({
    show: false,
    title: "",
    message: ""
  });

  // Informational (not an error) confirmation shown after a president saves an
  // event edit — see events.detailsReviewStatus in schema.ts: the edit always
  // goes through, but it silently re-flags the event for staff review, so this
  // is where that gets surfaced instead of leaving it invisible.
  const [reviewNoticeModal, setReviewNoticeModal] = useState<{
    show: boolean;
    title: string;
    message: string;
  }>({
    show: false,
    title: "",
    message: ""
  });


  const hasActualMedicalInfo = (user: AdminStudent | null | undefined) => {
    if (!user) return false;
    const fields = [
      user.chronicDiseases,
      user.medicalHistory,
      user.drugAllergies,
      user.foodAllergies,
      user.dietaryRestrictions,
      user.emergencyMedication
    ];
    const isMeaningful = (val: string | boolean | null | undefined) => {
      if (typeof val !== 'string') return !!val;
      const t = val.trim();
      return t !== "" && t !== "-";
    };
    return fields.some(isMeaningful) || user.faintingHistory === true;
  };

  // The "has a medical condition" signal shown to every admin-area role.
  // Admins compute it from the raw fields they receive; registration/organizer
  // only get the server-derived hasMedicalInfo boolean (no detail).
  const hasMedicalSignal = (user: AdminStudent | null | undefined) =>
    !!user && (user.hasMedicalInfo === true || hasActualMedicalInfo(user));

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The create/edit panel. Used to scroll it into view when it opens — the admin
  // content scrolls inside `.admin-main` (overflow-y:auto), NOT the window, so a
  // plain window.scrollTo does nothing. Re-runs on editingId so switching which
  // event you're editing (panel already open) also brings it back to the top.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showForm) return;
    const el = formRef.current;
    if (!el) return;
    const scroller = el.closest(".admin-main");
    if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
    else el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showForm, editingId]);

  const fetchEvents = async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/events", { signal });
      const data = await res.json();
      if (Array.isArray(data)) {
        setEvents(data);
      } else {
        setEvents([]);
        if (data && data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      // usePolling aborts the in-flight request on unmount / tab-hidden / overrun.
      // That's an intentional cancellation, not a failure — don't log it (Next's
      // dev overlay surfaces console.error) and don't wipe the list.
      if ((err as Error)?.name === "AbortError") return;
      console.error(err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  // Poll the events listing instead of holding an SSE connection (free-tier
  // friendly, pauses when the tab is hidden).
  usePolling(fetchEvents, 15000);

  // Clubs for the "Managed By" owner picker — fetched once, not polled (the
  // Clubs admin page is where staff manage the list itself).
  useEffect(() => {
    fetch("/api/admin/clubs")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setClubs(d); })
      .catch(() => {});
  }, []);

  // "Create Event from Proposal" entry point from /admin/proposals
  // (router.push(`/admin/events?fromProposal=${id}`)). Reads the query param via
  // plain window.location rather than useSearchParams(), which would force a
  // Suspense boundary onto this page for a param nothing here else needs.
  // Prefills every non-binding field the proposal carried (title/description/
  // time/registration window/location/quota/poster/walk-ins/audience/first-
  // year-only/suggested staff) plus a SUGGESTED managedByRoles/ownerClubIds —
  // staff still explicitly reviews/adjusts every field, especially points/
  // allowedRoles/allowedMajors, before submitting.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("fromProposal");
    if (!id) return;

    const toLocal = (iso: string) => {
      const d = new Date(iso);
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
    };

    fetch(`/api/admin/event-proposals/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((proposal) => {
        if (!proposal) return;
        setEditingId(null);
        setSourceProposalId(proposal.id);
        setFormData({
          ...EMPTY_FORM,
          title: proposal.title,
          description: proposal.description || "",
          location: proposal.location || "",
          quota: proposal.quota || 0,
          startTime: toLocal(proposal.startTime),
          endTime: toLocal(proposal.endTime),
          registrationOpenTime: proposal.registrationOpenTime ? toLocal(proposal.registrationOpenTime) : "",
          registrationCloseTime: proposal.registrationCloseTime ? toLocal(proposal.registrationCloseTime) : "",
          imageUrl: proposal.imageUrls?.[0] || proposal.imageUrl || "",
          imageUrls: proposal.imageUrls || (proposal.imageUrl ? [proposal.imageUrl] : []),
          walkInsEnabled: proposal.walkInsEnabled || false,
          walkInsOnly: proposal.walkInsOnly || false,
          quotaWalkIn: proposal.quotaWalkIn ?? null,
          targetThai: proposal.targetThai ?? true,
          targetInternational: proposal.targetInternational ?? true,
          quotaThai: proposal.quotaThai ?? null,
          quotaInternational: proposal.quotaInternational ?? null,
          firstYearOnly: proposal.firstYearOnly || false,
          staffUserIds: proposal.staffUserIds || [],
          // Suggested-access ACL — non-binding, same as every other prefilled
          // field here: staff still explicitly reviews/adjusts before saving.
          allowedRoles: proposal.allowedRoles || [],
          allowedMajors: proposal.allowedMajors || [],
          allowedClubs: proposal.allowedClubs || [],
          // A proposal is either club-owned or major-owned (clubId/majorCode
          // are mutually exclusive, see eventProposals in schema.ts) — prefill
          // the matching owner/managed-by suggestion; staff can still adjust
          // either before saving.
          ...(proposal.clubId
            ? { managedByRoles: ["club_president"], ownerClubIds: [proposal.clubId] }
            : { managedByRoles: ["major_president"], ownerMajors: [proposal.majorCode] }),
        });
        // A proposal's `sessions` (see eventProposals.sessions), when it has 2+
        // entries, is the COMPLETE per-day breakdown (mirrors this page's own
        // sessions model) — seed the Days editor with it directly and switch
        // registrationMode on. Otherwise it's a plain single-day proposal:
        // fall back to one row mirroring the proposal's own start/end.
        const suggestedDays: { title: string | null; startTime: string; endTime: string }[] = proposal.sessions || [];
        if (suggestedDays.length > 1) {
          setRegistrationMode("once");
          setSessions(suggestedDays.map((s) => ({ title: s.title || "", startTime: toLocal(s.startTime), endTime: toLocal(s.endTime), quotaWalkIn: null })));
        } else {
          setRegistrationMode(null);
          setSessions([{ title: "", startTime: toLocal(proposal.startTime), endTime: toLocal(proposal.endTime), quotaWalkIn: null }]);
        }
        setShowForm(true);
        ensureAssigneeUsersLoaded();
      })
      .catch(() => {});
    // Deliberately runs once on mount only — this is a one-time deep-link
    // prefill, not a state to keep re-syncing with the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Manage Feedback Form" shortcut from /admin/clubs or /admin/majors
  // (?openForm=<eventId>) — reduces the president's path from "find the event
  // in this list → open it → find the Feedback Form button" down to one click.
  // openFormBuilder is self-contained (fetches the event's forms by id alone),
  // but it also wants the event's title for the modal header, so this waits
  // for the (already president-scoped, see GET /api/admin/events) `events`
  // list to finish loading rather than making a second fetch just for that.
  // Fires once the id is found and then clears the querystring so a refresh
  // doesn't re-open it.
  const openFormHandledRef = useRef(false);
  useEffect(() => {
    if (openFormHandledRef.current || loading) return;
    const id = new URLSearchParams(window.location.search).get("openForm");
    if (!id) return;
    const evt = events.find((e) => e.id === id);
    if (!evt) return;
    openFormHandledRef.current = true;
    // Deferred via setTimeout so openFormBuilder's setState calls fire after
    // this render commits rather than synchronously within the effect body
    // (react-hooks/set-state-in-effect) — mirrors the pattern used elsewhere
    // in this codebase (e.g. admin/clubs/page.tsx's own load effect).
    const timer = setTimeout(() => {
      openFormBuilder(evt.id, evt.title);
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => clearTimeout(timer);
  }, [events, loading]);
  const editHandledRef = useRef(false);

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, val: typeof EMPTY_FORM[K]) => setFormData({ ...formData, [key]: val });

  // ---- Sessions / days editor helpers ----
  const updateSessionRow = (idx: number, patch: Partial<SessionRow>) => {
    setSessions((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const addSessionRow = () => {
    setSessions((prev) => {
      // Seed a new row two hours after the previous row's end (or empty if none).
      const last = prev[prev.length - 1];
      let startTime = "";
      let endTime = "";
      if (last?.endTime) {
        const d = new Date(last.endTime);
        if (!isNaN(d.getTime())) {
          const offset = d.getTimezoneOffset() * 60000;
          startTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
          d.setHours(d.getHours() + 2);
          endTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
        }
      }
      return [...prev, { title: "", startTime, endTime, quotaWalkIn: null }];
    });
  };
  const removeSessionRow = (idx: number) => {
    // Never leave the event with zero sessions.
    setSessions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };
  // Fixes a single row that spans multiple calendar days (see
  // sessionSpansTooLong) by replacing it in place with one row per day.
  const splitSessionRow = (idx: number) => {
    setSessions((prev) => {
      const row = prev[idx];
      const split = splitIntoDailySessions(row.startTime, row.endTime);
      if (split.length <= 1) return prev;
      const replacement = split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: row.quotaWalkIn }));
      return [...prev.slice(0, idx), ...replacement, ...prev.slice(idx + 1)];
    });
  };

  const injectMarkup = (prefix: string, suffix: string) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const selected = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    // Color: replace the color of an already-selected {{color:…|…}} block
    // instead of nesting another one; otherwise wrap the selection in a new
    // color block. Only ever acts on the CURRENT selection (never a
    // remembered range from a previous call) — a remembered range can go
    // stale the moment the user types or moves the cursor, silently editing
    // the wrong part of the text on the next color pick.
    if (prefix.startsWith("{{color:")) {
      const m = selected.match(/^\{\{color:[^|]*\|([\s\S]*)\}\}$/);
      const inner = m ? m[1] : selected || "text";
      const block = prefix + inner + suffix;
      set("description", before + block + after);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + block.length);
      }, 10);
      return;
    }

    if (prefix !== "" && selected.startsWith(prefix) && selected.endsWith(suffix)) {
      const unwrapped = selected.substring(prefix.length, selected.length - suffix.length);
      set("description", before + unwrapped + after);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + unwrapped.length);
      }, 10);
      return;
    }

    if (prefix === "**" && before.endsWith("**") && after.startsWith("**")) {
      set("description", before.slice(0, -2) + selected + after.slice(2));
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start - 2, end - 2);
      }, 10);
      return;
    }

    const content = selected || (prefix === "**" ? "bold text" : "text");
    const newText = before + prefix + content + suffix + after;
    set("description", newText);

    const finalStart = start;
    const finalEnd = start + prefix.length + content.length + suffix.length;

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(finalStart, finalEnd);
    }, 10);
  };

  // ---- Multi-poster management ----
  // Compress (Canvas → WebP) then upload a single image, returning its hosted URL.
  // Mirrors the original single-poster pipeline so output size/quality is unchanged.
  const compressAndUploadPoster = async (file: File): Promise<string | null> => {
    const compressImage = (imgFile: File): Promise<Blob> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(imgFile);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX_WIDTH = 1080;
            const MAX_HEIGHT = 1080;
            let width = img.width;
            let height = img.height;
            if (width > height) {
              if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width = Math.round((width * MAX_HEIGHT) / height);
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
              "image/webp",
              0.8
            );
          };
          img.onerror = reject;
        };
        reader.onerror = reject;
      });

    const compressedBlob = await compressImage(file);
    const useCompressed = compressedBlob.size < file.size;
    const finalFile = useCompressed ? compressedBlob : file;
    const body = new FormData();
    const originalName = file.name.substring(0, file.name.lastIndexOf("."));
    const extension = useCompressed ? "webp" : file.name.split(".").pop() || "png";
    body.append("file", finalFile, `${originalName || "poster"}.${extension}`);
    const res = await fetch("/api/upload", { method: "POST", body });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url as string;
  };

  // Tracks how many posters are still uploading so the UI can show progress.
  const [posterUploading, setPosterUploading] = useState(0);

  const addPosters = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setPosterUploading((n) => n + list.length);
    try {
      for (const file of list) {
        try {
          const url = await compressAndUploadPoster(file);
          if (url) {
            // Append one at a time so partial uploads still appear and ordering
            // follows selection order. Cover (imageUrl) stays as imageUrls[0].
            setFormData((prev) => {
              const next = [...prev.imageUrls, url];
              return { ...prev, imageUrls: next, imageUrl: next[0] };
            });
          }
        } catch (err) {
          console.error("Poster compression / upload failed:", err);
        } finally {
          setPosterUploading((n) => Math.max(0, n - 1));
        }
      }
    } catch {
      setPosterUploading(0);
    }
  };

  const removePoster = (idx: number) => {
    setFormData((prev) => {
      const next = prev.imageUrls.filter((_, i) => i !== idx);
      return { ...prev, imageUrls: next, imageUrl: next[0] || "" };
    });
  };

  const movePoster = (idx: number, dir: -1 | 1) => {
    setFormData((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.imageUrls.length) return prev;
      const next = [...prev.imageUrls];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, imageUrls: next, imageUrl: next[0] || "" };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Every row in `sessions` becomes one attendance session — and each session
    // only ever admits one check-in per student (idx_attendance_session_student).
    // Only block when a per-day schedule was actually chosen (registrationMode
    // "once") and one of THOSE rows itself spans >24h — a genuine mistake,
    // since each row is meant to be a single day. A plain multi-day start/end
    // with no split chosen (registrationMode null) is a deliberate "one
    // check-in for the whole range" event (e.g. a 3-day camp) and must NOT be
    // force-split — the banner shown for that case still offers Split as an
    // option, it just no longer blocks submission.
    if (registrationMode !== null && sessions.some((s) => sessionSpansTooLong(s.startTime, s.endTime))) {
      setError(t.multiDaySessionWarning);
      return;
    }

    setSubmitting(true);

    try {
      const url = editingId ? `/api/admin/events/${editingId}` : "/api/admin/events";
      const method = editingId ? "PUT" : "POST";
      const bodyData = editingId ? formData : formData;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bodyData,
          startTime: new Date(formData.startTime).toISOString(),
          endTime: new Date(formData.endTime).toISOString(),
          registrationOpenTime: formData.registrationOpenTime ? new Date(formData.registrationOpenTime).toISOString() : null,
          registrationCloseTime: formData.registrationCloseTime ? new Date(formData.registrationCloseTime).toISOString() : null,
          registrationMode: registrationMode ?? "once",
          // Send the full desired list of sessions. Existing rows carry their id
          // (PUT updates them); new rows omit it (inserted). Drop rows with no
          // valid start/end so the API's z.string().datetime() validation passes.
          sessions: sessions
            .filter((s) => s.startTime && s.endTime)
            .map((s) => ({
              ...(s.id ? { id: s.id } : {}),
              title: s.title.trim() || null,
              startTime: new Date(s.startTime).toISOString(),
              endTime: new Date(s.endTime).toISOString(),
              quotaWalkIn: s.quotaWalkIn,
            })),
          // Only on a fresh create sourced from a proposal (never on an edit) —
          // flips the proposal to 'approved' in the same transaction server-side.
          ...(sourceProposalId && !editingId ? { proposalId: sourceProposalId } : {}),
        }),
      });

      if (res.ok) {
        // A president's edit is never applied live — it's held as a pending
        // proposal until staff approve it (see PUT /api/admin/events/[id]
        // and events.pendingDetailsChanges in schema.ts). Surface that
        // explicitly whenever this save actually produced a pending change,
        // so it doesn't look like the edit vanished; a genuine no-op save
        // (nothing actually changed) produces no pending changes and this
        // stays silent, same as today.
        const result = await res.json().catch(() => null);
        const savedEvent = result?.event as AdminEvent | undefined;
        const submittedForReview =
          isAttendanceOnly && isPresidentRole && !!editingId && !!savedEvent?.pendingDetailsChanges;
        setShowForm(false);
        setFormData(EMPTY_FORM);
        setRegistrationMode(null);
        setSessions([]);
        setEditingId(null);
        setSourceProposalId(null);
        fetchEvents();
        if (submittedForReview) {
          setReviewNoticeModal({
            show: true,
            title: t.eventDetailsReviewNoticeTitle || "Submitted for review",
            message: t.eventDetailsReviewNoticeDesc || "Your changes were submitted for staff review. Students will keep seeing the previously-approved version until staff approve them.",
          });
        }
      } else {
        const err = await res.json();
        setError(err.error || "Failed to save event");
        setErrorModal({
          show: true,
          title: lang === "th" ? "การบันทึกข้อมูลล้มเหลว" : "Save Failed",
          message: err.error || (lang === "th" ? "ไม่สามารถบันทึกข้อมูลกิจกรรมได้" : "Failed to save event details.")
        });
      }
    } catch (err) {
      setError("Something went wrong");
      setErrorModal({
        show: true,
        title: lang === "th" ? "เกิดข้อผิดพลาด" : "System Error",
        message: lang === "th" ? "เกิดข้อผิดพลาดบางอย่างกรุณาลองใหม่อีกครั้ง" : "Something went wrong. Please try again."
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmModal({
      show: true,
      title: lang === "th" ? "คุณแน่ใจหรือไม่?" : "Are you sure?",
      message: lang === "th" 
        ? "การดำเนินการนี้จะลบกิจกรรมและบันทึกการเช็คอินทั้งหมดของกิจกรรมนี้อย่างถาวร!" 
        : "This will permanently delete this event and all associated attendance records!",
      confirmText: lang === "th" ? "ลบกิจกรรม" : "Delete Event",
      cancelText: lang === "th" ? "ยกเลิก" : "Cancel",
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, show: false }));
        setDeletingId(id);
        try {
          const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
          if (res.ok) {
            fetchEvents();
          } else {
            const err = await res.json();
            setErrorModal({
              show: true,
              title: lang === "th" ? "การลบล้มเหลว" : "Delete Failed",
              message: err.error || (lang === "th" ? "ไม่สามารถลบกิจกรรมได้" : "Failed to delete event")
            });
          }
        } catch (err) {
          setErrorModal({
            show: true,
            title: lang === "th" ? "เกิดข้อผิดพลาด" : "Error Occurred",
            message: lang === "th" ? "เกิดข้อผิดพลาดบางอย่าง" : "Something went wrong"
          });
        } finally {
          setDeletingId(null);
        }
      }
    });
  };

  // Removes a student's registration/check-in for the currently open event
  // (all sessions, for a multi-day event) — admin/registration only, see
  // canRemoveRegistrant above.
  const removeRegistrant = (studentId: string, studentName: string) => {
    if (!activeEventId) return;
    setConfirmModal({
      show: true,
      title: lang === "th" ? "ยกเลิกการลงทะเบียน?" : "Remove registration?",
      message: lang === "th"
        ? `การดำเนินการนี้จะลบการลงทะเบียน/เช็คอินของ ${studentName} สำหรับกิจกรรมนี้ทั้งหมด (ทุกวัน)`
        : `This will remove ${studentName}'s registration and check-in for this event entirely (all days).`,
      confirmText: lang === "th" ? "ลบการลงทะเบียน" : "Remove Registration",
      cancelText: lang === "th" ? "ยกเลิก" : "Cancel",
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, show: false }));
        setRemovingStudentId(studentId);
        try {
          const res = await fetch(
            `/api/admin/events/${activeEventId}/attendance?studentId=${encodeURIComponent(studentId)}`,
            { method: "DELETE" }
          );
          if (res.ok) {
            setAttendance(prev => prev.filter(a => a.studentId !== studentId));
          } else {
            const err = await res.json().catch(() => null);
            setErrorModal({
              show: true,
              title: lang === "th" ? "ลบไม่สำเร็จ" : "Remove Failed",
              message: (err && err.error) || (lang === "th" ? "ไม่สามารถลบการลงทะเบียนได้" : "Failed to remove registration"),
            });
          }
        } catch (err) {
          setErrorModal({
            show: true,
            title: lang === "th" ? "เกิดข้อผิดพลาด" : "Error Occurred",
            message: lang === "th" ? "เกิดข้อผิดพลาดบางอย่าง" : "Something went wrong",
          });
        } finally {
          setRemovingStudentId(null);
        }
      }
    });
  };

  const handleEdit = (evt: AdminEvent) => {
    setSongsueResyncMessage(null);
    const toLocal = (iso: string) => {
      const d = new Date(iso);
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
    };

    // A president reopening their own event with an unreviewed pending edit
    // sees their last-submitted draft, not the stale live values — otherwise
    // it would look like their edit was silently discarded. Staff always see
    // live values here; the diff banner in the form shows what's pending
    // separately (see the pending-review banner further down this file).
    // Trusted without re-validation — this JSON only ever holds a payload
    // that already passed the PUT route's own schema check at submit time.
    const isPresidentDraftView = isAttendanceOnly && isPresidentRole && !!evt.pendingDetailsChanges;
    const pending: Record<string, unknown> = (isPresidentDraftView && evt.pendingDetailsChanges) || {};
    const eff = <T,>(key: string, fallback: T): T =>
      pending[key] !== undefined ? (pending[key] as T) : fallback;

    // Editing an existing event is never "from a proposal" — clears any
    // leftover sourceProposalId from a previous create-from-proposal open.
    setSourceProposalId(null);
    setFormData({
      title: eff("title", evt.title),
      description: eff("description", evt.description) || "",
      location: eff("location", evt.location) || "",
      startTime: toLocal(eff("startTime", evt.startTime)),
      endTime: toLocal(eff("endTime", evt.endTime)),
      registrationOpenTime: eff("registrationOpenTime", evt.registrationOpenTime)
        ? toLocal(eff("registrationOpenTime", evt.registrationOpenTime)!)
        : "",
      registrationCloseTime: eff("registrationCloseTime", evt.registrationCloseTime)
        ? toLocal(eff("registrationCloseTime", evt.registrationCloseTime)!)
        : "",
      quota: eff("quota", evt.quota) || 0,
      pointsAwarded: evt.pointsAwarded || 0,
      individualPointsAwarded: evt.individualPointsAwarded || 0,
      imageUrl: eff("imageUrl", evt.imageUrl) || "",
      // Legacy events have only imageUrl — wrap it so the manager shows one poster.
      imageUrls: (() => {
        const urls = eff("imageUrls", evt.imageUrls);
        const cover = eff("imageUrl", evt.imageUrl);
        return urls && urls.length > 0 ? urls : (cover ? [cover] : []);
      })(),
      walkInsEnabled: eff("walkInsEnabled", evt.walkInsEnabled) || false,
      walkInsOnly: eff("walkInsOnly", evt.walkInsOnly) || false,
      quotaWalkIn: eff("quotaWalkIn", evt.quotaWalkIn) || null,
      targetThai: eff("targetThai", evt.targetThai) !== false,
      targetInternational: eff("targetInternational", evt.targetInternational) !== false,
      quotaThai: eff("quotaThai", evt.quotaThai) || null,
      quotaInternational: eff("quotaInternational", evt.quotaInternational) || null,
      // Role/access/points/Managed By/staff are staff-only — always from the
      // live event, never from a president's pending payload (it can never
      // contain them, see PRESIDENT_EDITABLE_FIELDS server-side).
      allowedRoles: evt.allowedRoles || [],
      allowedMajors: evt.allowedMajors || [],
      allowedClubs: evt.allowedClubs || [],
      firstYearOnly: eff("firstYearOnly", evt.firstYearOnly) || false,
      managedByRoles: evt.managedByRoles || [],
      ownerClubIds: evt.ownerClubIds || [],
      ownerMajors: evt.ownerMajors || [],
      staffUserIds: evt.staffUserIds || [],
      songsueLinked: evt.songsueLinked || false,
      detailsReviewStatus: evt.detailsReviewStatus || "pending",
      detailsReviewedAt: evt.detailsReviewedAt || null,
    });
    // Load the people directory once for the Event Staff picker (best-effort).
    ensureAssigneeUsersLoaded();
    const pendingSessions = eff<
      { id?: string; title?: string | null; startTime: string; endTime: string; quotaWalkIn?: number | null }[] | undefined
    >("sessions", undefined);
    const registrationModeEff = eff<"once" | "per_session" | undefined>("registrationMode", evt.registrationMode);
    // Only pre-select a mode (which reveals the Days editor) when the event is
    // genuinely multi-day or per-session. A plain single-session "once" event
    // edits cleanly with the mode left unselected, just like creating one.
    const sessionCount = pendingSessions ? pendingSessions.length : (evt.sessions?.length ?? 0);
    const isMultiDay = sessionCount > 1 || registrationModeEff === "per_session";
    setRegistrationMode(isMultiDay ? (registrationModeEff === "per_session" ? "per_session" : "once") : null);
    // Pre-populate the days editor from the pending draft's sessions when
    // viewing one (a president's proposed schedule, unmatched to sortOrder
    // since it's a flat proposed list), else from the live event's sessions,
    // carrying each id so PUT updates rather than recreates them. Sort by
    // sortOrder for a stable order. Legacy events without sessions fall back
    // to one row mirroring start/end.
    const evtSessions = pendingSessions
      ? pendingSessions.map((s) => ({
          id: s.id,
          title: s.title || "",
          startTime: toLocal(s.startTime),
          endTime: toLocal(s.endTime),
          quotaWalkIn: s.quotaWalkIn ?? null,
        }))
      : (evt.sessions && evt.sessions.length > 0)
      ? [...evt.sessions]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({
            id: s.id,
            title: s.title || "",
            startTime: toLocal(s.startTime),
            endTime: toLocal(s.endTime),
            quotaWalkIn: s.quotaWalkIn,
          }))
      : [{ title: "", startTime: toLocal(evt.startTime), endTime: toLocal(evt.endTime), quotaWalkIn: null }];
    setSessions(evtSessions);
    setEditingId(evt.id);
    setShowForm(true);
    // Scrolling is handled by the showForm/editingId effect, which targets the
    // real scroll container (.admin-main) rather than the window.
  };

  // "Review" shortcut from /admin/reviews (?edit=<eventId>) — opens the plain
  // event editor directly, same deep-link shape as the ?openForm= effect
  // above. Declared after handleEdit (referenced below) rather than before it.
  useEffect(() => {
    if (editHandledRef.current || loading) return;
    const id = new URLSearchParams(window.location.search).get("edit");
    if (!id) return;
    const evt = events.find((e) => e.id === id);
    if (!evt) return;
    editHandledRef.current = true;
    const timer = setTimeout(() => {
      handleEdit(evt);
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, loading]);

  // Staff-only approve action (see events.detailsReviewStatus/
  // pendingDetailsChanges in schema.ts) — a president's edit is held as a
  // pending diff, never applied live; this is what actually applies it,
  // clearing the pending flag in the same request. Only ever called from the
  // edit form's pending-review banner, itself staff-only (presidents never
  // see it — canEditRestrictedFields gates its render below).
  const approveEventDetails = async () => {
    if (!editingId) return;
    setDetailsReviewToggling(true);
    try {
      const res = await fetch(`/api/admin/events/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detailsReviewStatus: "approved" }),
      });
      if (res.ok) {
        // Approving APPLIES the pending diff to the live event (including
        // sessions, which aren't part of this response's event row) — close
        // and refetch rather than patching local form/session state in
        // place, so what's shown always matches what's now actually live.
        setShowForm(false);
        setFormData(EMPTY_FORM);
        setRegistrationMode(null);
        setSessions([]);
        setEditingId(null);
        fetchEvents();
      } else {
        const d = await res.json().catch(() => null);
        setError((d && d.error) || "Failed to update review status.");
      }
    } catch (e) {
      console.error(e);
      setError("Failed to update review status.");
    } finally {
      setDetailsReviewToggling(false);
    }
  };

  // Staff-only: drop a pending president edit without applying it — live
  // fields stay exactly as they are (a president's edit never touches them
  // until approved), this just clears the pending flag. Mirrors
  // approveEventDetails above; see PUT /api/admin/events/[id].
  const discardPendingDetails = async () => {
    if (!editingId) return;
    setDetailsReviewToggling(true);
    try {
      const res = await fetch(`/api/admin/events/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discardPendingDetails: true }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormData(EMPTY_FORM);
        setRegistrationMode(null);
        setSessions([]);
        setEditingId(null);
        fetchEvents();
      } else {
        const d = await res.json().catch(() => null);
        setError((d && d.error) || "Failed to discard pending changes.");
      }
    } catch (e) {
      console.error(e);
      setError("Failed to discard pending changes.");
    } finally {
      setDetailsReviewToggling(false);
    }
  };

  // Manually re-fires the event-level Songsue mirror (POST .../songsue-resync).
  // songsue-sync.ts has no retry queue in v1: if the original sync attempt
  // failed (Songsue down, network blip), the event silently never lands on
  // Songsue's side and every registration sync 404s forever until someone
  // re-triggers this. See src/lib/songsue-sync.ts.
  const resyncSongsue = async () => {
    if (!editingId) return;
    setSongsueResyncing(true);
    setSongsueResyncMessage(null);
    try {
      const res = await fetch(`/api/admin/events/${editingId}/songsue-resync`, { method: "POST" });
      if (res.ok) {
        setSongsueResyncMessage(t.songsueResyncSuccess);
      } else {
        const d = await res.json().catch(() => null);
        setSongsueResyncMessage((d && d.error) || t.songsueResyncFailure);
      }
    } catch (e) {
      console.error(e);
      setSongsueResyncMessage(t.songsueResyncFailure);
    } finally {
      setSongsueResyncing(false);
    }
  };

  const viewAttendance = async (eventId: string) => {
    // Token this request so a stale, slower response from a previously-opened
    // event can't overwrite the roster of the one now in view.
    const reqId = ++attendanceReqRef.current;
    setActiveEventId(eventId);
    setShowAttendance(true);
    setLoadingAttendance(true);
    setAttendanceError(null);
    setAttendance([]);
    setFilterMedical(false);
    setFilterNotCheckedIn(false);
    setFilterStudentsOnly(false);
    setFilterMaster(false);
    setFilterPhd(false);
    setFilterThai(true);
    setFilterInternational(true);
    setSelectedSessionId(null);
    // Assigned-but-not-yet-registered staff are rendered from this directory
    // (see groupedAttendance below), so make sure it's loaded even if the
    // admin opens the roster without first opening the event editor.
    ensureAssigneeUsersLoaded();
    try {
      const res = await fetch(`/api/admin/events/${eventId}/attendance`);
      const data = await res.json().catch(() => null);
      // Ignore if a newer viewAttendance() superseded this one.
      if (attendanceReqRef.current !== reqId) return;
      if (!res.ok) {
        setAttendance([]);
        setAttendanceError((data && data.error) || "Failed to load attendance.");
        return;
      }
      setAttendance(Array.isArray(data) ? data : []);
    } catch (err) {
      if (attendanceReqRef.current !== reqId) return;
      console.error(err);
      setAttendance([]);
      setAttendanceError("Failed to load attendance.");
    } finally {
      if (attendanceReqRef.current === reqId) setLoadingAttendance(false);
    }
  };

  // Sessions (days) of the event whose roster is open, sorted as displayed in the
  // editor. Drives the per-day filter pills — shown only for true multi-day events.
  const activeEventSessions = [...(events.find((e) => e.id === activeEventId)?.sessions ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const isMultiDayEvent = activeEventSessions.length > 1;

  // Student ids who never checked into ANY session of this event despite
  // being registered — mirrors findNoShowStudentIds in
  // api/admin/events/[id]/apply-strikes/route.ts (registered with no
  // 'attended' row anywhere in the event, excluding isStaff), so this filter
  // and the tally below match exactly who strikes would apply to.
  const eventNoShowIds = useMemo(() => {
    const attended = new Set(attendance.filter((m) => m.status === "attended").map((m) => m.studentId));
    // Includes 'no_show' rows (not just 'registered') so this filter still catches
    // someone AFTER apply-strikes has already flipped their row — otherwise the
    // filter goes empty for any event that's already been struck.
    return new Set(
      attendance
        .filter((m) => (m.status === "registered" || m.status === "no_show") && !m.isStaff && !attended.has(m.studentId))
        .map((m) => m.studentId)
    );
  }, [attendance]);

  const filteredAttendance = useMemo(() => attendance.filter((m) => {
    if (selectedSessionId && m.session?.id !== selectedSessionId) {
      return false;
    }
    if (filterMedical && !hasMedicalSignal(m.user)) {
      return false;
    }
    if (filterNotCheckedIn && m.status !== "registered") {
      return false;
    }
    if (filterStrikeHistory && !((m.user?.noShowCount ?? 0) > 0)) {
      return false;
    }
    if (filterEventNoShow && !eventNoShowIds.has(m.studentId)) {
      return false;
    }
    if (filterStudentsOnly && !isRegularStudent(m.user)) {
      return false;
    }
    if (filterMaster && !MASTER_MAJORS.includes(m.user?.major || "")) {
      return false;
    }
    if (filterPhd && !PHD_MAJORS.includes(m.user?.major || "")) {
      return false;
    }

    const studentId = m.user?.studentId || "";
    const cleanId = studentId.trim();
    
    let isThai = true;
    let isIntl = false;
    
    if (cleanId.length >= 3) {
      const lastThreeDigitFirst = cleanId.slice(-3)[0];
      if (lastThreeDigitFirst === "5") {
        isThai = false;
        isIntl = true;
      } else if (["0", "1", "2", "3", "4"].includes(lastThreeDigitFirst)) {
        isThai = true;
        isIntl = false;
      }
    }
    
    if (!filterThai && isThai) {
      return false;
    }
    if (!filterInternational && isIntl) {
      return false;
    }

    if (yearFilter.size > 0) {
      const y = yearOfStudy(m.user?.studentId);
      const bucket = y == null ? null : (y >= 5 ? 5 : y);
      if (bucket == null || !yearFilter.has(bucket)) return false;
    }

    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasMedicalSignal is pure over its `user` arg (no state/props); listing it would recreate each render and defeat the memo
  }), [attendance, selectedSessionId, filterMedical, filterNotCheckedIn, filterStrikeHistory, filterEventNoShow, eventNoShowIds, filterStudentsOnly, filterMaster, filterPhd, filterThai, filterInternational, yearFilter]);

  // Header tallies honor the selected day (but not the other roster filters) so
  // "X / Y checked in" matches whichever day is being viewed.
  const sessionScoped = useMemo(() => selectedSessionId
    ? attendance.filter((m) => m.session?.id === selectedSessionId)
    : attendance, [attendance, selectedSessionId]);
  // In the "All days" view a person who took part in several sessions has one
  // row per day. Counting the raw rows would SUM the days (e.g. Day1 271 +
  // Day2 246 = 517), which double-counts anyone present on both days. Collapse
  // to one unit per student — keyed exactly like the roster cards — so the
  // tallies count distinct people. With a day selected there's ≤1 row per
  // person already, so each row is its own unit (no behavior change).
  const tallyUnits = useMemo<AdminAttendance[][]>(() => selectedSessionId
    ? sessionScoped.map((m) => [m])
    : (() => {
        const byStudent = new Map<string, AdminAttendance[]>();
        for (const m of sessionScoped) {
          const k = m.studentId || m.user?.studentId || m.id;
          const arr = byStudent.get(k);
          if (arr) arr.push(m);
          else byStudent.set(k, [m]);
        }
        return [...byStudent.values()];
      })(), [sessionScoped, selectedSessionId]);
  // Attendance summary for the day in view (mirrors the exported report's stats).
  // Based on the day-scoped set, not the browsing filters (medical/nationality).
  // A person is classified once across all their day rows: pre-registered if any
  // session was a pre-registration (else walk-in), attended if present on any day.
  // All five tallies derive purely from tallyUnits, so compute them together once
  // per roster change instead of five full passes on every render / 15s poll.
  const { checkInCount, registeredCount, summaryPreRegistered, summaryAttendedPre, summaryWalkIns, summaryPreRegisteredNonStaff, summaryAttendedPreNonStaff } = useMemo(() => ({
    checkInCount: tallyUnits.filter(rows => rows.some(m => m.status === "attended")).length,
    registeredCount: tallyUnits.length,
    summaryPreRegistered: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered")).length,
    summaryAttendedPre: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered") && rows.some(m => m.status === "attended")).length,
    summaryWalkIns: tallyUnits.filter(rows => rows.every(m => m.method === "walk-in")).length,
    // Staff-excluded variants feed the No-shows tile below, which is directly
    // tied to the "Strike No-shows" action — it must match who apply-strikes
    // (isStaff-excluded, see findNoShowStudentIds) will actually strike.
    summaryPreRegisteredNonStaff: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered" && !m.isStaff)).length,
    summaryAttendedPreNonStaff: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered" && !m.isStaff) && rows.some(m => m.status === "attended")).length,
  }), [tallyUnits]);
  const summaryNoShows = Math.max(0, summaryPreRegisteredNonStaff - summaryAttendedPreNonStaff);
  const summaryNoShowPct = summaryPreRegisteredNonStaff > 0 ? Math.round((summaryNoShows / summaryPreRegisteredNonStaff) * 100) : 0;
  // Shared by the attendance modal's action bar (export/strike buttons),
  // computed once instead of re-deriving events.find(...) inline per button.
  const activeEvent = events.find((e) => e.id === activeEventId);
  const showExportButton = canSeeExportButton && !loadingAttendance && attendance.length > 0;
  const showStrikeButton = canApplyStrikes && !loadingAttendance && attendance.length > 0
    && !!activeEvent && new Date() > new Date(activeEvent.endTime);
  const attendanceSummaryTiles = [
    {
      key: "checkedIn",
      label: lang === "th" ? "เช็คอินแล้ว" : lang === "cn" ? "已签到" : lang === "mm" ? "ချက်အင်ပြီး" : "Checked In",
      value: checkInCount,
      color: "#10b981",
    },
    {
      key: "preReg",
      label: lang === "th" ? "ลงทะเบียนล่วงหน้า" : lang === "cn" ? "预先登记" : lang === "mm" ? "ကြိုတင်စာရင်းသွင်း" : "Pre-registered",
      value: summaryPreRegistered,
      color: "var(--accent-primary)",
    },
    {
      key: "walkIn",
      label: lang === "th" ? "วอล์กอิน" : lang === "cn" ? "现场加入" : lang === "mm" ? "ဝင်ရောက်" : "Walk-ins",
      value: summaryWalkIns,
      color: "#3b82f6",
    },
    {
      key: "noShow",
      label: lang === "th" ? "ไม่มา" : lang === "cn" ? "缺席" : lang === "mm" ? "မလာသူ" : "No-shows",
      value: summaryNoShows,
      sub: summaryPreRegistered > 0 ? `${summaryNoShowPct}%` : null,
      color: "#ef4444",
    },
  ];

  // In the "All days" view a person who attended several sessions has one
  // attendance row per day. Collapse those into a single unit (one card with a
  // per-day breakdown inside) so the roster shows people, not (person × day)
  // duplicates. When a specific day is selected there's already ≤1 row per
  // person, so each row is its own unit and the card renders exactly as before.
  type AttendanceUnit = { key: string; primary: AdminAttendance; rows: AdminAttendance[] };
  const attendanceUnits = useMemo<AttendanceUnit[]>(() => {
    if (selectedSessionId) {
      return filteredAttendance.map((m) => ({ key: m.id, primary: m, rows: [m] }));
    }
    const byStudent = new Map<string, AttendanceUnit>();
    const order: string[] = [];
    for (const m of filteredAttendance) {
      const k = m.studentId || m.user?.studentId || m.id;
      let unit = byStudent.get(k);
      if (!unit) {
        unit = { key: k, primary: m, rows: [] };
        byStudent.set(k, unit);
        order.push(k);
      }
      unit.rows.push(m);
    }
    // Order each person's day rows Day 1 → Day N for a stable read.
    for (const u of byStudent.values()) {
      u.rows.sort((a, b) => (a.session?.sortOrder ?? 0) - (b.session?.sortOrder ?? 0));
      u.primary = u.rows[0];
    }
    return order.map((k) => byStudent.get(k)!);
  }, [filteredAttendance, selectedSessionId]);

  // Fallback signal: who operated the scanner for at least one check-in on
  // this event (attendance.scannedBy, set by the scanner API to the
  // operator's own user id — see scanner.service.ts). Catches an ad-hoc
  // helper who wasn't pre-assigned to event.staffUserIds but ended up
  // running the scanner anyway. Built from the full, unfiltered attendance
  // list so a person who scanned on Day 1 still shows as staff on Day 2.
  const eventStaffIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of attendance) {
      if (a.scannedBy) ids.add(a.scannedBy);
    }
    return ids;
  }, [attendance]);

  // The event whose roster is open — source of the explicit staffUserIds
  // assignment list (attendance rows only carry a per-row isStaff snapshot,
  // not the current live list, so unregistered assignees have to come from
  // here instead).
  const activeEventStaffUserIds = useMemo(
    () => events.find((e) => e.id === activeEventId)?.staffUserIds ?? [],
    [events, activeEventId]
  );

  // Staff = anyone whose row is flagged isStaff (they were on the event's
  // explicit staffUserIds list when they registered/checked in — the
  // authoritative, pre-assigned signal), OR who shows up in the scannedBy
  // fallback above, OR who is on the event's *current* staffUserIds list
  // even though their attendance row predates that assignment (isStaff is a
  // frozen snapshot taken at register time — see schema comment — so
  // someone added to staff after they already registered/checked in would
  // otherwise never flip sections), PLUS anyone currently on staffUserIds
  // who hasn't registered/checked in at all yet (no attendance row exists
  // for them, so they'd otherwise be invisible here despite being explicitly
  // assigned). Split into their own section, ahead of the house-grouped
  // regular students.
  const groupedAttendance = useMemo(() => {
    const staff: AttendanceUnit[] = [];
    const students: AttendanceUnit[] = [];
    const registeredIds = new Set<string>();
    for (const unit of attendanceUnits) {
      registeredIds.add(unit.primary.studentId);
      const uid = unit.primary.user?.id;
      const isStaff =
        unit.primary.isStaff ||
        (!!uid && eventStaffIds.has(uid)) ||
        (!!uid && activeEventStaffUserIds.includes(uid));
      (isStaff ? staff : students).push(unit);
    }
    for (const uid of activeEventStaffUserIds) {
      if (registeredIds.has(uid)) continue;
      const person = assigneeUsers.find((u) => u.id === uid);
      const placeholder: AdminAttendance = {
        id: `unregistered-staff-${uid}`,
        eventId: activeEventId || "",
        studentId: uid,
        checkInTime: null,
        method: null,
        status: "not_registered",
        scannedBy: null,
        medsCheckOption: null,
        isStaff: true,
        user: {
          id: uid,
          name: person?.name || "Unknown",
          nickname: null,
          studentId: person?.studentId || null,
          email: "",
          phone: null,
          major: null,
          role: person?.role || null,
          roles: person?.role ? [person.role] : null,
          religion: null,
          contactChannels: null,
          chronicDiseases: null,
          medicalHistory: null,
          drugAllergies: null,
          foodAllergies: null,
          dietaryRestrictions: null,
          faintingHistory: null,
          emergencyMedication: null,
          emergencyContacts: [],
          houseId: null,
          house: null,
        },
      };
      staff.push({ key: uid, primary: placeholder, rows: [placeholder] });
    }
    const houses = students.reduce((acc: Record<string, AttendanceUnit[]>, curr) => {
      const houseId = curr.primary.user?.house?.id || "Unassigned";
      if (!acc[houseId]) acc[houseId] = [];
      acc[houseId].push(curr);
      return acc;
    }, {} as Record<string, AttendanceUnit[]>);
    return { staff, houses };
  }, [attendanceUnits, eventStaffIds, activeEventStaffUserIds, assigneeUsers, activeEventId]);

  // Export the event's attendees as .xlsx. The file is built server-side at
  // /api/admin/events/[id]/export, which re-checks the role (staff vs.
  // thin-roster — the button is also gated via canSeeExportButton), scopes
  // president roles to events they manage, strips sensitive columns for
  // thin-roster roles, and audit-logs the pull. We just trigger the download;
  // the browser sends the session cookie.
  const exportAttendanceXlsx = () => {
    if (!activeEventId) return;
    // Carry the selected day through to the server so the spreadsheet matches the
    // on-screen roster (one sheet per day). No day selected → the whole event.
    const qs = selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : "";
    const a = document.createElement("a");
    a.href = `/api/admin/events/${activeEventId}/export${qs}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // No-show strike-out: fetch the preview roster (students still 'registered'
  // with no 'attended' row anywhere in the event) before the organizer commits
  // to striking them. Read-only — /api/admin/events/[id]/apply-strikes GET.
  const openStrikesModal = async () => {
    if (!activeEventId) return;
    setShowStrikesModal(true);
    setStrikesResult(null);
    setStrikesPoints(NO_SHOW_PENALTY_POINTS);
    setStrikesLoading(true);
    try {
      const res = await fetch(`/api/admin/events/${activeEventId}/apply-strikes`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load no-show preview");
      setStrikesPreview(data.students || []);
    } catch (e) {
      setStrikesPreview([]);
      setErrorModal({ show: true, title: "Couldn't load no-shows", message: e instanceof Error ? e.message : "Please try again." });
      setShowStrikesModal(false);
    } finally {
      setStrikesLoading(false);
    }
  };

  // Organizer-confirmed POST — strikes every current no-show for this event.
  // Idempotent server-side, but we also refresh the roster afterward so the
  // "Not Checked In" filter/summary reflect the new no_show status immediately.
  const confirmApplyStrikes = async () => {
    if (!activeEventId) return;
    setStrikesSubmitting(true);
    try {
      const res = await fetch(`/api/admin/events/${activeEventId}/apply-strikes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: strikesPoints }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to apply strikes");
      setStrikesResult(data);
      setStrikesPreview([]);
      viewAttendance(activeEventId);
    } catch (e) {
      setErrorModal({ show: true, title: "Couldn't apply strikes", message: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setStrikesSubmitting(false);
    }
  };

  // Meds-check badge — PDPA-gated to super_admin/admin or a president viewing
  // their own event (canSeeRawMedicalDetail), since the presence of a meds
  // check reveals who has a medical condition. Shared by the single-day card
  // and each day-row of a collapsed multi-day card.
  const renderMedsBadge = (option: string | null, badgeKey?: string) => {
    if (!canSeeRawMedicalDetail || !option) return null;
    const color = option === "brought" ? "#10b981" : option === "forgot" ? "#ef4444" : "#3b82f6";
    const bg = option === "brought" ? "rgba(16, 185, 129, 0.12)" : option === "forgot" ? "rgba(239, 68, 68, 0.12)" : "rgba(59, 130, 246, 0.12)";
    const border = option === "brought" ? "rgba(16, 185, 129, 0.2)" : option === "forgot" ? "rgba(239, 68, 68, 0.2)" : "rgba(59, 130, 246, 0.2)";
    const label = option === "brought"
      ? "Brought Meds / พกยามาด้วย"
      : option === "forgot"
      ? "No Meds (Risk) / ไม่ได้พกยา (รับความเสี่ยง)"
      : "Acknowledged / รับทราบข้อมูล";
    return (
      <div key={badgeKey} style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6,
        padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 800,
        textTransform: "uppercase", background: bg, color, border: `1px solid ${border}`,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
        {label}
      </div>
    );
  };

  // One roster card, shared by the Staff section and each house group so the
  // two sections stay visually identical apart from the role badge (staff
  // only — house-grouped students already carry their house color).
  const renderAttendanceCard = (unit: AttendanceUnit) => {
    const m = unit.primary;
    // A person attending >1 session collapses into one card with a Day 1 → Day N
    // breakdown (only in the "All days" view). Single-row units render exactly as before.
    const multiDay = unit.rows.length > 1;
    const attendedDays = unit.rows.filter((r) => r.status === "attended").length;
    const assignedStaff = m.isStaff;
    const staffMember = assignedStaff || (!!m.user?.id && eventStaffIds.has(m.user.id));
    const unregistered = m.status === "not_registered";
    return (
      <div key={unit.key} className="attendance-card" style={{
        padding: "18px",
        background: "var(--bg-surface)",
        borderRadius: 20,
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.02)"
      }}>
        {/* Header: identity on the left, actions + status on the right. */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 800, fontSize: 16, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{m.user?.name}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>{m.user?.studentId || "No ID"}</p>
              {staffMember && (
                <span title={`${assignedStaff ? "Assigned as event staff" : "Checked attendees in for this event"} · base role: ${primaryRoleLabel(m.user)}`} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 800,
                  textTransform: "uppercase", letterSpacing: "0.03em",
                  background: "rgba(99, 102, 241, 0.12)", color: "#6366f1", border: "1px solid rgba(99, 102, 241, 0.25)",
                }}>
                  <ShieldCheck size={10} />
                  {primaryRoleLabel(m.user)}
                </span>
              )}
              {!multiDay && (
                <>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--border-medium)" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} className="text-muted" />
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                      {m.checkInTime ? new Date(m.checkInTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) : "-"}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {!unregistered && hasMedicalSignal(m.user) && (
              <div style={{ color: "#ef4444", animation: "pulse-glow 2s infinite" }} title="Medical Condition">
                <Activity size={20} />
              </div>
            )}
            {/* Student Profile: admin/super_admin only for now — every other
                role/position (registration, organizer, smo, presidents, etc.)
                is TBD and excluded until that's determined; canExportAttendance
                already means exactly "super_admin or admin". */}
            {!unregistered && canExportAttendance && (
              <button
                className="btn btn-ghost"
                style={{ padding: 8, borderRadius: 10 }}
                onClick={() => setSelectedStudent(m.user || null)}
              >
                <Info size={18} />
              </button>
            )}
            {/* Remove registration: admin/registration only (server re-checks —
                see DELETE .../attendance). Deliberately excludes organizer,
                presidents, and smo to avoid peer-bias/conflict-of-interest risk. */}
            {!unregistered && canRemoveRegistrant && m.user?.id && (
              <button
                className="btn btn-ghost"
                style={{ padding: 8, borderRadius: 10, color: "#ef4444" }}
                title={lang === "th" ? "ลบการลงทะเบียน" : "Remove registration"}
                disabled={removingStudentId === m.user.id}
                onClick={() => removeRegistrant(m.user!.id, m.user!.name || m.user!.studentId || "this student")}
              >
                {removingStudentId === m.user.id ? <div className="spinner w-4 h-4 border-2" /> : <UserX size={18} />}
              </button>
            )}
            {multiDay ? (
              <div style={{ minWidth: 50, height: 32, padding: "0 10px", borderRadius: 16, background: attendedDays > 0 ? "rgba(16,185,129,0.1)" : "rgba(255,107,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, color: attendedDays > 0 ? "#10b981" : "var(--accent-primary)", fontSize: 13, fontWeight: 800, border: attendedDays > 0 ? "none" : "1px dashed var(--accent-primary)" }} title={`${attendedDays} / ${unit.rows.length} ${lang === "th" ? "วันเช็คอินแล้ว" : "days checked in"}`}>
                <CheckCircle2 size={14} />
                {attendedDays}/{unit.rows.length}
              </div>
            ) : m.status === "attended" ? (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#10b981" }} title="Checked In">
                <CheckCircle2 size={16} />
              </div>
            ) : unregistered ? (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", border: "1px dashed var(--border-medium)" }} title="Assigned as staff — hasn't registered or checked in yet">
                <User size={14} />
              </div>
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,107,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", border: "1px dashed var(--accent-primary)" }} title="Registered (Not Checked In)">
                <Clock size={14} className="animate-pulse" />
              </div>
            )}
          </div>
        </div>

        {/* Body. The meds-check badge reveals who went through the
            medication check (i.e. who has a medical condition), so
            renderMedsBadge restricts it to super_admin/admin. */}
        {multiDay ? (
          // One contained row per session this person took part in:
          // day label, that day's check-in time / registered state,
          // and (for admins) that day's meds-check badge.
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {unit.rows.map((r) => {
              const dayLabel = r.session?.title?.trim() || `${lang === "th" ? "วันที่" : lang === "cn" ? "第" : lang === "mm" ? "နေ့" : "Day"} ${(r.session?.sortOrder ?? 0) + 1}`;
              const checked = r.status === "attended";
              return (
                <div key={r.id} style={{ padding: "10px 12px", borderRadius: 14, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 12, fontWeight: 800, color: "var(--text-secondary)",
                    }}>
                      <Calendar size={12} />
                      {dayLabel}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: checked ? "#10b981" : "var(--accent-primary)", flexShrink: 0 }}>
                      {checked ? <CheckCircle2 size={13} /> : <Clock size={13} className="animate-pulse" />}
                      {checked
                        ? (r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) : (lang === "th" ? "เช็คอินแล้ว" : lang === "cn" ? "已签到" : lang === "mm" ? "ချက်အင်ပြီး" : "Checked in"))
                        : (lang === "th" ? "ลงทะเบียน" : lang === "cn" ? "已登记" : lang === "mm" ? "စာရင်းသွင်း" : "Registered")}
                    </span>
                  </div>
                  {renderMedsBadge(r.medsCheckOption, r.id)}
                </div>
              );
            })}
          </div>
        ) : (
          renderMedsBadge(m.medsCheckOption)
        )}
      </div>
    );
  };

  const getEventStatus = (evt: AdminEvent) => {
    const now = new Date();
    if (now >= new Date(evt.startTime) && now <= new Date(evt.endTime)) return "live";
    if (now > new Date(evt.endTime)) return "past";
    return "upcoming";
  };

  // Live now first, then upcoming, then past (past sinks to the bottom);
  // within each bucket sort by date — soonest first for live/upcoming,
  // most-recently-ended first for past so recent history stays visible.
  const STATUS_ORDER: Record<string, number> = { live: 0, upcoming: 1, past: 2 };

  const filteredEvents = useMemo(() => Array.isArray(events) ? events.filter(evt => {
    const matchesSearch = evt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (evt.location && evt.location.toLowerCase().includes(searchQuery.toLowerCase()));

    const now = new Date();
    const isLive = now >= new Date(evt.startTime) && now <= new Date(evt.endTime);
    const isPast = now > new Date(evt.endTime);
    const isUpcoming = now < new Date(evt.startTime);

    if (filterStatus === "live") return matchesSearch && isLive;
    if (filterStatus === "past") return matchesSearch && isPast;
    if (filterStatus === "upcoming") return matchesSearch && isUpcoming;
    return matchesSearch;
  }).sort((a, b) => {
    const statusA = getEventStatus(a);
    const statusB = getEventStatus(b);
    if (statusA !== statusB) return STATUS_ORDER[statusA] - STATUS_ORDER[statusB];

    if (statusA === "past") return new Date(b.endTime).getTime() - new Date(a.endTime).getTime();
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  }) : [], [events, searchQuery, filterStatus]);

  return (
    <>
      <div className="animate-fade-in-up" style={{ paddingBottom: 100 }}>
        {/* Main Header */}
        <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 20 }}>
          <h1 className="text-[clamp(32px,5vw,48px)] font-black tracking-tighter text-[var(--text-primary)] leading-tight">{t.eventsTitle}</h1>
          {!isAttendanceOnly && (
          <button
            className={`btn ${showForm ? "btn-ghost" : "btn-primary"} flex-shrink-0 transition-all duration-300 ${!showForm && "shadow-[0_12px_32px_var(--accent-glow)]"}`}
            style={{ gap: 10, minHeight: 52, paddingInline: 28, borderRadius: 99, fontSize: 15, fontWeight: 700 }}
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                setEditingId(null);
                setFormData(EMPTY_FORM);
                setSourceProposalId(null);
                setRegistrationMode(null);
                setSessions([]);
              } else {
                setEditingId(null);
                setFormData(EMPTY_FORM);
                setSourceProposalId(null);
                setRegistrationMode(null);
                // Seed one empty session row so a single-day event still submits
                // a valid session; it stays in sync with start/end below.
                setSessions([{ title: "", startTime: "", endTime: "", quotaWalkIn: null }]);
                setShowForm(true);
                ensureAssigneeUsersLoaded();
              }
            }}
          >
            {showForm ? <><X size={18} /> {lang === "th" ? "ปิดตัวแก้ไข" : lang === "cn" ? "关闭编辑器" : lang === "mm" ? "အယ်ဒီတာ ပိတ်ရန်" : "Close Editor"}</> : <><Plus size={18} /> {t.addEventBtn}</>}
          </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3" style={{ marginBottom: 48 }}>
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            <input
              className="input w-full h-12"
              style={{ paddingLeft: 48, borderRadius: 16, border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}
              placeholder={t.searchEventsPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "live", "upcoming", "past"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "8px 20px",
                  minHeight: 44,
                  borderRadius: 99,
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "capitalize",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  border: filterStatus === s ? "1px solid var(--accent-primary)" : "1px solid transparent",
                  background: filterStatus === s ? "var(--accent-glow)" : "var(--bg-elevated)",
                  color: filterStatus === s ? "var(--accent-primary)" : "var(--text-secondary)"
                }}
              >
                {s === "all" ? t.filterAll : s === "live" ? t.filterLive : s === "upcoming" ? t.filterUpcoming : t.filterPast}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div
          ref={formRef}
          className="animate-fade-in-up"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-medium)",
            borderRadius: "clamp(20px, 4vw, 32px)",
            padding: "clamp(20px, 5vw, 40px)",
            marginBottom: 48,
            boxShadow: "0 40px 80px rgba(0,0,0,0.1)",
            position: "relative",
            overflow: "hidden"
          }}
        >
          {/* Form Background Decor */}
          <div style={{ position: "absolute", top: 0, right: 0, width: 300, height: 300, background: "radial-gradient(circle at top right, var(--accent-glow), transparent)", pointerEvents: "none" }} />

          <h2 style={{ fontSize: "clamp(22px, 5vw, 28px)", fontWeight: 900, marginBottom: 32, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 28, background: "var(--accent-primary)", borderRadius: 5 }} />
            {editingId ? t.editEventTitle : t.newEventTitle}
          </h2>

          {/* Always-editable + hold-for-review banner (see events.detailsReviewStatus/
              pendingDetailsChanges in schema.ts): a president is never locked out of
              editing — their edit is just held as a pending diff instead of touching
              the live event, purely informational here. */}
          {isAttendanceOnly && isPresidentRole && editingId && formData.detailsReviewStatus === "pending" &&
            events.find((e) => e.id === editingId)?.pendingDetailsChanges && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)",
              borderRadius: 16, padding: "16px 20px", marginBottom: 24,
            }}>
              <AlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 800, fontSize: 13, color: "#f59e0b" }}>
                  {t.eventDetailsPendingBannerTitle || "Pending staff review"}
                </p>
                <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>
                  {t.eventDetailsPendingBannerDesc || "You can keep editing — students still see the previously-approved version until admin/registration staff approve these changes."}
                </p>
              </div>
            </div>
          )}
          {/* Staff view of a PRESIDENT'S pending edit — see
              events.detailsReviewStatus/pendingDetailsChanges in schema.ts. Only
              shown when there is actually something to review: a brand-new event
              (or one staff just created/edited themselves) is auto-marked approved
              at creation (see POST /api/admin/events), and an event nobody but
              staff can ever edit (no club/major president in managedByRoles) can
              never generate a pending edit in the first place. Once shown, it
              disappears the moment staff approves or discards (or the president
              edits again, which just re-shows it with the latest diff). Mirrors
              the same ownerClubIds/ownerMajors-only filter GET /api/admin/reviews
              uses for its queue. The live event is untouched the whole time — see
              PUT /api/admin/events/[id] — so the diff below is computed against
              events.pendingDetailsChanges vs. the current live values, not
              formData (which for staff always shows live values). */}
          {!isAttendanceOnly && editingId && formData.detailsReviewStatus === "pending" &&
            (formData.managedByRoles.includes("club_president") || formData.managedByRoles.includes("major_president")) &&
            events.find((e) => e.id === editingId)?.pendingDetailsChanges && (() => {
            const editingEvent = events.find((e) => e.id === editingId);
            const diffRows = editingEvent?.pendingDetailsChanges
              ? formatPendingDetailsDiff(editingEvent.pendingDetailsChanges, editingEvent, t)
              : [];
            return (
              <div style={{
                display: "flex", flexDirection: "column", gap: 12,
                background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)",
                borderRadius: 16, padding: "16px 20px", marginBottom: 24,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <AlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <p style={{ fontWeight: 800, fontSize: 13, color: "#f59e0b" }}>
                        {t.eventDetailsPendingStaffLabel || "President edited this event"}
                      </p>
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>
                        {t.eventDetailsPendingStaffDesc || "The club/major president proposed the changes below. The live event is unaffected until you approve them."}
                      </p>
                      {editingEvent?.pendingSubmitter && (
                        <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
                          {t.eventDetailsPendingSubmittedByLabel || "Submitted by:"} {editingEvent.pendingSubmitter.name}
                          {editingEvent.pendingDetailsSubmittedAt && ` · ${new Date(editingEvent.pendingDetailsSubmittedAt).toLocaleString("en-GB")}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: "transparent", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.4)",
                      }}
                      disabled={detailsReviewToggling}
                      onClick={discardPendingDetails}
                    >
                      {detailsReviewToggling ? <div className="spinner w-3 h-3 border-2" /> : <X size={14} />}
                      {t.eventDetailsDiscardBtn || "Discard"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: "#f59e0b", color: "#fff", border: "none",
                        boxShadow: "0 2px 8px rgba(245, 158, 11, 0.35)",
                      }}
                      disabled={detailsReviewToggling}
                      onClick={approveEventDetails}
                    >
                      {detailsReviewToggling ? <div className="spinner w-3 h-3 border-2" /> : <CheckCircle2 size={14} />}
                      {t.eventDetailsApproveBtn || "Approve changes"}
                    </button>
                  </div>
                </div>
                {diffRows.length > 0 && (
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px",
                  }}>
                    {diffRows.map((row) => (
                      <p key={row.key} style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                        <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong>{" "}
                        {row.oldText} <span style={{ color: "#f59e0b", fontWeight: 700 }}>→</span> {row.newText}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <form onSubmit={handleSubmit} className="relative">
            <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-10">
              {/* Left Column: Basic Info */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div className="field">
                  <label className="label">{t.eventTitleLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                  <input className="input" required value={formData.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. IT Freshy Night 2026" style={{ fontSize: 16, padding: "16px 20px", borderRadius: 16 }} />
                </div>

                <div className="field">
                  <label className="label">{t.eventLocationLabel}</label>
                  <div style={{ position: "relative" }}>
                    <MapPin size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                    <input className="input" value={formData.location} onChange={(e) => set("location", e.target.value)} placeholder="CAMT Auditorium" style={{ paddingLeft: 44 }} />
                  </div>
                </div>

                {/* Two parallel point pools: house points go to the WINNING house at
                    event-end; individual points go to EACH attendee on every check-in. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventPointsLabel}</label>
                    <div style={{ position: "relative", opacity: canEditRestrictedFields ? 1 : 0.5 }}>
                      <Trophy size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#fbbf24" }} />
                      <input className="input" type="number" min={0} disabled={!canEditRestrictedFields} value={formData.pointsAwarded} onChange={(e) => set("pointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                    <p style={{ fontSize: 11, color: canEditRestrictedFields ? "var(--text-muted)" : "#f59e0b", fontWeight: canEditRestrictedFields ? 400 : 700, marginTop: 6 }}>
                      {canEditRestrictedFields ? t.eventHousePointsHint : t.eventStaffOnlyFieldHint}
                    </p>
                  </div>
                  <div className="field">
                    <label className="label">{t.eventIndividualPointsLabel}</label>
                    <div style={{ position: "relative", opacity: canEditRestrictedFields ? 1 : 0.5 }}>
                      <Sparkles size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--accent-primary)" }} />
                      <input className="input" type="number" min={0} disabled={!canEditRestrictedFields} value={formData.individualPointsAwarded} onChange={(e) => set("individualPointsAwarded", Number(e.target.value))} style={{ paddingLeft: 44 }} />
                    </div>
                    <p style={{ fontSize: 11, color: canEditRestrictedFields ? "var(--text-muted)" : "#f59e0b", fontWeight: canEditRestrictedFields ? 400 : 700, marginTop: 6 }}>
                      {canEditRestrictedFields ? t.eventIndividualPointsHint : t.eventStaffOnlyFieldHint}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventStartTimeLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                    <input
                      className="input"
                      required
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.startTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newFormData = { ...formData, startTime: val };
                        // Automatically suggest an end time 2 hours later if not set
                        if (val && (!formData.endTime || formData.endTime < val)) {
                          const d = new Date(val);
                          d.setHours(d.getHours() + 2);
                          const offset = d.getTimezoneOffset() * 60000;
                          newFormData.endTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
                        }
                        setFormData(newFormData);
                        // For a single-day event (no mode chosen → Days editor
                        // hidden), keep the sole session row mirrored to the main
                        // start/end so the time still reaches the session on save.
                        if (registrationMode === null && sessions.length === 1) {
                          setSessions([{ ...sessions[0], startTime: val, endTime: newFormData.endTime }]);
                        }
                      }}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t.eventEndTimeLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                    <input
                      className="input"
                      required
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.endTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        set("endTime", val);
                        if (registrationMode === null && sessions.length === 1) {
                          setSessions([{ ...sessions[0], endTime: val }]);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* No mode chosen yet → this range IS the sole session (mirrored
                    above). Warn here since the Days editor that would normally
                    catch this is hidden in that state. */}
                {registrationMode === null && sessionSpansTooLong(formData.startTime, formData.endTime) && (
                  <div style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    background: "color-mix(in srgb, #f59e0b 12%, transparent)",
                    border: "1px solid color-mix(in srgb, #f59e0b 40%, transparent)",
                    borderRadius: 12, padding: "10px 14px",
                  }}>
                    <AlertCircle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                        {t.multiDaySessionWarning}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const split = splitIntoDailySessions(formData.startTime, formData.endTime);
                          if (split.length > 1) {
                            setRegistrationMode("once");
                            setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: null })));
                          }
                        }}
                        className="btn btn-ghost"
                        style={{ alignSelf: "flex-start", fontSize: 12, padding: "6px 12px", borderRadius: 10 }}
                      >
                        {t.splitIntoDays}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventRegistrationOpenLabel}</label>
                    <input
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.registrationOpenTime}
                      onChange={(e) => set("registrationOpenTime", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t.eventRegistrationCloseLabel}</label>
                    <input
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={formData.registrationCloseTime}
                      onChange={(e) => set("registrationCloseTime", e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="field">
                    <label className="label">{t.eventQuotaLabel}</label>
                    <div style={{ position: "relative" }}>
                      <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input className="input" type="number" min={1} value={formData.quota || ""} onChange={(e) => set("quota", e.target.value ? Number(e.target.value) : 0)} placeholder={t.unlimitedIfZero} style={{ paddingLeft: 44 }} />
                    </div>
                  </div>

                  <div className="field" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div
                      onClick={() => {
                        // Locked on while Walk-ins Only is set — that mode implies
                        // walkInsEnabled, so it can't be turned off independently.
                        if (formData.walkInsOnly) return;
                        const nextVal = !formData.walkInsEnabled;
                        setFormData({
                          ...formData,
                          walkInsEnabled: nextVal,
                          ...(!nextVal && { quotaWalkIn: null })
                        });
                        // Walk-ins off → clear any per-day walk-in quotas too, so
                        // re-enabling later starts clean (the per-day fields are hidden).
                        if (!nextVal) {
                          setSessions((prev) => prev.map((s) => ({ ...s, quotaWalkIn: null })));
                        }
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: formData.walkInsOnly ? "not-allowed" : "pointer",
                        opacity: formData.walkInsOnly ? 0.6 : 1,
                        border: formData.walkInsEnabled ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.walkInsEnabled ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.walkInsEnabled ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.walkInsEnabled && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.walkInsEnabled ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.allowWalkins}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Walk-ins Only — no pre-registration accepted at all (see
                    api/events/[id]/register). Implies Allow Walk-ins. */}
                <div className="field" style={{ marginTop: 20 }}>
                  <div
                    onClick={() => {
                      const nextVal = !formData.walkInsOnly;
                      setFormData({
                        ...formData,
                        walkInsOnly: nextVal,
                        ...(nextVal && { walkInsEnabled: true }),
                      });
                    }}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.walkInsOnly ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, flexShrink: 0, borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.walkInsOnly ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.walkInsOnly ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s"
                    }}>
                      {formData.walkInsOnly && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <DoorOpen size={18} style={{ flexShrink: 0, color: formData.walkInsOnly ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.walkInsOnly ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.walkInsOnlyToggleLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {t.walkInsOnlyToggleHint}
                      </span>
                    </div>
                  </div>
                </div>

                {formData.walkInsEnabled && !formData.walkInsOnly && (
                  <div className="field" style={{ marginTop: 20 }}>
                    <label className="label">{t.walkInQuota}</label>
                    <div style={{ position: "relative" }}>
                      <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <input 
                        className="input" 
                        type="number" 
                        min={1} 
                        value={formData.quotaWalkIn || ""} 
                        onChange={(e) => set("quotaWalkIn", e.target.value ? Number(e.target.value) : null)} 
                        placeholder={t.unlimitedIfEmpty}
                        style={{ paddingLeft: 44 }}
                      />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                      {t.walkInQuotaHint}
                    </p>
                  </div>
                )}

                <div className="field" style={{ marginTop: 20 }}>
                  <label className="label">{t.targetAudience}</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div
                      onClick={() => {
                        const nextVal = !formData.targetThai;
                        setFormData({
                          ...formData,
                          targetThai: nextVal,
                          ...(!nextVal && { quotaThai: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.targetThai ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.targetThai ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.targetThai ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.targetThai && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.targetThai ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.thaiStudents}
                      </span>
                    </div>

                    <div
                      onClick={() => {
                        const nextVal = !formData.targetInternational;
                        setFormData({
                          ...formData,
                          targetInternational: nextVal,
                          ...(!nextVal && { quotaInternational: null })
                        });
                      }}
                      style={{
                        height: 48,
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 16px",
                        cursor: "pointer",
                        border: formData.targetInternational ? "1px solid var(--accent-primary)" : "1px solid transparent",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "2px solid var(--border-medium)",
                        background: formData.targetInternational ? "var(--accent-primary)" : "transparent",
                        borderColor: formData.targetInternational ? "var(--accent-primary)" : "var(--border-medium)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s"
                      }}>
                        {formData.targetInternational && <CheckCircle2 size={16} color="white" />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.targetInternational ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.internationalStudents}
                      </span>
                    </div>
                  </div>

                  {/* Cohort Quota Limits */}
                  {(formData.targetThai || formData.targetInternational) && (
                    <div className="grid gap-5 mt-5" style={{ 
                      gridTemplateColumns: formData.targetThai && formData.targetInternational ? "repeat(auto-fit, minmax(200px, 1fr))" : "1fr"
                    }}>
                      {formData.targetThai && (
                        <div className="field">
                          <label className="label">{t.thaiStudentQuota}</label>
                          <div style={{ position: "relative" }}>
                            <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                            <input 
                              className="input" 
                              type="number" 
                              min={1} 
                              value={formData.quotaThai || ""} 
                              onChange={(e) => set("quotaThai", e.target.value ? Number(e.target.value) : null)} 
                              placeholder={t.unlimitedIfEmpty} 
                              style={{ paddingLeft: 44 }} 
                            />
                          </div>
                        </div>
                      )}

                      {formData.targetInternational && (
                        <div className="field">
                          <label className="label">{t.intlStudentQuota}</label>
                          <div style={{ position: "relative" }}>
                            <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                            <input 
                              className="input" 
                              type="number" 
                              min={1} 
                              value={formData.quotaInternational || ""} 
                              onChange={(e) => set("quotaInternational", e.target.value ? Number(e.target.value) : null)} 
                              placeholder={t.unlimitedIfEmpty} 
                              style={{ paddingLeft: 44 }} 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quota Conflicts Warning */}
                  {(() => {
                    const warnings: string[] = [];
                    const globalLimit = Number(formData.quota) || 0;
                    const thaiLimit = formData.targetThai ? (Number(formData.quotaThai) || 0) : 0;
                    const intlLimit = formData.targetInternational ? (Number(formData.quotaInternational) || 0) : 0;

                    if (globalLimit > 0) {
                      if (formData.targetThai && thaiLimit > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `โควตาสำหรับนักศึกษาไทย (${thaiLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
                            : `Thai student limit (${thaiLimit}) exceeds the overall Participant Quota (${globalLimit}).`
                        );
                      }
                      if (formData.targetInternational && intlLimit > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `โควตาสำหรับนักศึกษาต่างชาติ (${intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit})`
                            : `International student limit (${intlLimit}) exceeds the overall Participant Quota (${globalLimit}).`
                        );
                      }
                      if (formData.targetThai && formData.targetInternational && thaiLimit > 0 && intlLimit > 0 && (thaiLimit + intlLimit) > globalLimit) {
                        warnings.push(
                          lang === "th"
                            ? `ผลรวมโควตาของนักศึกษาไทยและต่างชาติ (${thaiLimit + intlLimit}) มีจำนวนมากกว่าโควตาทั้งหมดของกิจกรรม (${globalLimit}) ทั้งนี้ ระบบจะปิดรับการลงทะเบียนเมื่อผู้สมัครเต็มตามจำนวนโควตาทั้งหมด (${globalLimit} คน)`
                            : `The sum of Thai and International student limits (${thaiLimit + intlLimit}) exceeds the overall Participant Quota (${globalLimit}). The event will stop accepting registrations once the overall limit of ${globalLimit} is reached.`
                        );
                      }
                    }
                    if (warnings.length === 0) return null;

                    return (
                      <div style={{
                        marginTop: 20,
                        padding: "16px 20px",
                        background: "rgba(245, 158, 11, 0.1)",
                        border: "1px solid rgba(245, 158, 11, 0.2)",
                        borderRadius: 16,
                        color: "#f59e0b",
                        fontSize: 13,
                        fontWeight: 600,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        boxShadow: "0 4px 12px rgba(245, 158, 11, 0.05)"
                      }}>
                        {warnings.map((w, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: "#f59e0b" }} />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* First-year-only restriction */}
                <div className="field" style={{ marginTop: 20 }}>
                  <div
                    onClick={() => set("firstYearOnly", !formData.firstYearOnly)}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.firstYearOnly ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.firstYearOnly ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.firstYearOnly ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.1s"
                    }}>
                      {formData.firstYearOnly && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <GraduationCap size={18} style={{ flexShrink: 0, color: formData.firstYearOnly ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.firstYearOnly ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.firstYearOnly}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {(t.firstYearOnlyHint || "").replace("{prefix}", currentFirstYearPrefix())}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Registration mode + Sessions / Days editor */}
                <div className="field" style={{ marginTop: 4 }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Calendar size={16} style={{ color: "var(--accent-primary)" }} />
                    {t.registrationModeLabel}
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: 999,
                      padding: "1px 8px",
                    }}>
                      {t.registrationModeOptional}
                    </span>
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
                    {t.registrationModeHint}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {([
                      // Not flagged "recommended" — it's the only supported mode today
                      // (per_session below is unbuilt), so a "recommended" badge next to
                      // the sole option would misleadingly imply it was chosen among
                      // real alternatives. See registrationModeHint for the full context.
                      { value: "once" as const, label: t.registrationModeOnce, desc: t.registrationModeOnceDesc, recommended: false },
                      // 'per_session' (separate sign-up each day) is intentionally
                      // hidden: the student registration flow has no per-day path yet,
                      // so picking it would create an event where Day-2 pre-registrants
                      // get pushed into the walk-in path. Re-enable once per-session
                      // registration ships. See docs/features/multi-day-checkin-implementation.md §10.
                      // { value: "per_session" as const, label: t.registrationModePerSession, desc: t.registrationModePerSessionDesc, recommended: false },
                    ]).map((opt) => {
                      const active = registrationMode === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => {
                            if (active) {
                              // Click again to un-select — collapse back to a single
                              // session row mirroring the main start/end, matching
                              // the registrationMode === null convention used above.
                              const first = sessions[0];
                              setRegistrationMode(null);
                              setSessions([{ title: first?.title ?? "", startTime: formData.startTime, endTime: formData.endTime, quotaWalkIn: first?.quotaWalkIn ?? null }]);
                            } else {
                              setRegistrationMode(opt.value);
                              // The sole row still mirrors the main start/end. If that
                              // range itself spans multiple calendar days, split it into
                              // one row per day right away — otherwise "Day 1" would
                              // silently cover the whole multi-day range as one session
                              // (see sessionSpansTooLong).
                              const first = sessions[0];
                              if (first?.startTime && first?.endTime) {
                                const split = splitIntoDailySessions(first.startTime, first.endTime);
                                if (split.length > 1) {
                                  setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: first.quotaWalkIn ?? null })));
                                }
                              }
                            }
                          }}
                          style={{
                            minHeight: 48,
                            background: "var(--bg-elevated)",
                            borderRadius: 16,
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 16px",
                            cursor: "pointer",
                            border: active ? "1px solid var(--accent-primary)" : "1px solid transparent",
                            transition: "all 0.2s",
                          }}
                        >
                          <div style={{
                            width: 22,
                            height: 22,
                            flexShrink: 0,
                            marginTop: 1,
                            borderRadius: "50%",
                            border: active ? "2px solid var(--accent-primary)" : "2px solid var(--border-medium)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "all 0.1s",
                          }}>
                            {active && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)" }} />}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.35 }}>
                                {opt.label}
                              </span>
                              {opt.recommended && (
                                <span style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: "var(--accent-primary)",
                                  background: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
                                  border: "1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)",
                                  borderRadius: 999,
                                  padding: "1px 8px",
                                  letterSpacing: 0.2,
                                  whiteSpace: "nowrap",
                                }}>
                                  {t.registrationModeRecommended}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.4 }}>
                              {opt.desc}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Sessions / Days — only shown once a registration mode is chosen
                    (multi-day events). A single-day event needs no mode and its
                    lone session mirrors the main start/end above. At least one row
                    is always required. */}
                {registrationMode !== null && (
                <div className="field">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Clock size={16} style={{ color: "var(--accent-primary)" }} />
                    {t.sessionsHeading}
                  </label>
                  <div style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--accent-primary)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    marginBottom: 14,
                  }}>
                    <Calendar size={15} style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                      {registrationMode === "per_session" ? t.sessionsNotePerSession : t.sessionsNoteOnce}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {sessions.map((s, idx) => (
                      <div
                        key={s.id ?? `new-${idx}`}
                        style={{
                          background: "var(--bg-elevated)",
                          borderRadius: 16,
                          padding: 16,
                          border: "1px solid var(--border-subtle, transparent)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            className="input"
                            value={s.title}
                            onChange={(e) => updateSessionRow(idx, { title: e.target.value })}
                            placeholder={`${t.sessionTitleLabel} (${lang === "th" ? "วันที่" : lang === "cn" ? "第" : lang === "mm" ? "နေ့" : "Day"} ${idx + 1})`}
                            style={{ flex: 1, minWidth: 0 }}
                          />
                          <button
                            type="button"
                            onClick={() => removeSessionRow(idx)}
                            disabled={sessions.length <= 1}
                            title={t.removeDay}
                            style={{
                              width: 40,
                              height: 40,
                              flexShrink: 0,
                              borderRadius: 12,
                              border: "1px solid var(--border-medium)",
                              background: "transparent",
                              color: sessions.length <= 1 ? "var(--text-muted)" : "#ef4444",
                              cursor: sessions.length <= 1 ? "not-allowed" : "pointer",
                              opacity: sessions.length <= 1 ? 0.4 : 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.eventStartTimeLabel}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              lang="en-GB"
                              value={s.startTime}
                              onChange={(e) => updateSessionRow(idx, { startTime: e.target.value })}
                            />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.eventEndTimeLabel}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              lang="en-GB"
                              value={s.endTime}
                              onChange={(e) => updateSessionRow(idx, { endTime: e.target.value })}
                            />
                          </div>
                        </div>
                        {sessionSpansTooLong(s.startTime, s.endTime) && (
                          <div style={{
                            display: "flex", gap: 10, alignItems: "flex-start",
                            background: "color-mix(in srgb, #f59e0b 12%, transparent)",
                            border: "1px solid color-mix(in srgb, #f59e0b 40%, transparent)",
                            borderRadius: 12, padding: "10px 14px",
                          }}>
                            <AlertCircle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                                {t.multiDaySessionWarning}
                              </span>
                              <button
                                type="button"
                                onClick={() => splitSessionRow(idx)}
                                className="btn btn-ghost"
                                style={{ alignSelf: "flex-start", fontSize: 12, padding: "6px 12px", borderRadius: 10 }}
                              >
                                {t.splitIntoDays}
                              </button>
                            </div>
                          </div>
                        )}
                        {formData.walkInsEnabled && !formData.walkInsOnly && (
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.sessionWalkInQuota}</label>
                            <div style={{ position: "relative" }}>
                              <Users size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                              <input
                                className="input"
                                type="number"
                                min={1}
                                value={s.quotaWalkIn ?? ""}
                                onChange={(e) => updateSessionRow(idx, { quotaWalkIn: e.target.value ? Number(e.target.value) : null })}
                                placeholder={t.unlimitedIfEmpty}
                                style={{ paddingLeft: 40 }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addSessionRow}
                    className="btn btn-ghost"
                    style={{ marginTop: 12, gap: 8, borderRadius: 14 }}
                  >
                    <Plus size={16} /> {t.addDay}
                  </button>
                </div>
                )}
              </div>

              {/* Right Column: Poster & Description */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Role Access Control — admin/registration/organizer only */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามบทบาท)" : "Role-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกบทบาทที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกบทบาท"
                      : "Select which roles can see & join this event. Leave all unchecked = visible to everyone."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_PARTICIPANT_ROLES.map((role) => {
                      const isSelected = formData.allowedRoles.includes(role);
                      const roleColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
                        student: {
                          bg: isSelected ? "rgba(99,102,241,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(99,102,241,0.5)" : "transparent",
                          text: isSelected ? "#6366f1" : "var(--text-secondary)",
                          badge: "#6366f1",
                        },
                        staff: {
                          bg: isSelected ? "rgba(20,184,166,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(20,184,166,0.5)" : "transparent",
                          text: isSelected ? "#14b8a6" : "var(--text-secondary)",
                          badge: "#14b8a6",
                        },
                        smo: {
                          bg: isSelected ? "rgba(139,92,246,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(139,92,246,0.5)" : "transparent",
                          text: isSelected ? "#8b5cf6" : "var(--text-secondary)",
                          badge: "#8b5cf6",
                        },
                        anusmo: {
                          bg: isSelected ? "rgba(236,72,153,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(236,72,153,0.5)" : "transparent",
                          text: isSelected ? "#ec4899" : "var(--text-secondary)",
                          badge: "#ec4899",
                        },
                        club_president: {
                          bg: isSelected ? "rgba(245,158,11,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(245,158,11,0.5)" : "transparent",
                          text: isSelected ? "#f59e0b" : "var(--text-secondary)",
                          badge: "#f59e0b",
                        },
                        major_president: {
                          bg: isSelected ? "rgba(6,182,212,0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgba(6,182,212,0.5)" : "transparent",
                          text: isSelected ? "#06b6d4" : "var(--text-secondary)",
                          badge: "#06b6d4",
                        },
                      };
                      const c = roleColors[role];
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.allowedRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, allowedRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? c.badge : "transparent",
                            border: `2px solid ${isSelected ? c.badge : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: c.text }}>
                            {ROLE_LABELS[role as ParticipantRole]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedRoles.length === 0
                        ? "rgba(16,185,129,0.1)"
                        : "rgba(99,102,241,0.1)",
                      color: formData.allowedRoles.length === 0 ? "#10b981" : "#6366f1",
                      border: `1px solid ${formData.allowedRoles.length === 0 ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)"}`,
                    }}>
                      {formData.allowedRoles.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกบทบาท" : "✓ Open to all roles")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>
                </div>

                {/* Major Access Control — limits which student majors may join.
                    Combined with the role filter as AND. Empty = all majors.
                    admin/registration/organizer only. */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามสาขา)" : "Major-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกสาขาที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกสาขา"
                      : "Select which majors can see & join this event. Leave all unchecked = open to every major."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_MAJORS.map((major) => {
                      const isSelected = formData.allowedMajors.includes(major);
                      return (
                        <div
                          key={major}
                          onClick={() => {
                            const current = formData.allowedMajors;
                            const next = current.includes(major)
                              ? current.filter((m) => m !== major)
                              : [...current, major];
                            setFormData({ ...formData, allowedMajors: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: isSelected ? "rgba(255,107,0,0.12)" : "var(--bg-elevated)",
                            border: `1px solid ${isSelected ? "rgba(255,107,0,0.5)" : "transparent"}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 80,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? "var(--accent-primary)" : "transparent",
                            border: `2px solid ${isSelected ? "var(--accent-primary)" : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span
                            title={MAJOR_LABELS[major]}
                            style={{ fontSize: 13, fontWeight: 800, color: isSelected ? "var(--accent-primary)" : "var(--text-secondary)" }}
                          >
                            {major}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedMajors.length === 0
                        ? "rgba(16,185,129,0.1)"
                        : "rgba(255,107,0,0.1)",
                      color: formData.allowedMajors.length === 0 ? "#10b981" : "var(--accent-primary)",
                      border: `1px solid ${formData.allowedMajors.length === 0 ? "rgba(16,185,129,0.2)" : "rgba(255,107,0,0.2)"}`,
                    }}>
                      {formData.allowedMajors.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกสาขา" : "✓ Open to all majors")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedMajors.join(", ")}`}
                    </div>
                  </div>
                </div>

                {/* Club Access Control — limits registration to member(s) of specific
                    club(s) (any club_members role — member or president). Combined
                    with the role/major filters as AND. Empty = no club restriction.
                    admin/registration/organizer only. SEPARATE from "Owning club(s)"
                    below, which controls who MANAGES the event, not who may join. */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Building2 size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามชมรม)" : "Club-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "จำกัดให้เฉพาะสมาชิกชมรมที่เลือกเท่านั้นที่เห็น/เข้าร่วมกิจกรรมนี้ได้ หากไม่เลือก = ไม่จำกัดตามชมรม"
                      : "Restrict this event to members of the selected club(s) (add members under Admin > Clubs). Leave unchecked = no club restriction."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {clubs.filter((c) => !c.isArchived).length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                      {lang === "th" ? "ยังไม่มีชมรม — สร้างได้ที่ Admin > Clubs" : "No clubs yet — create one under Admin > Clubs."}
                    </p>
                  ) : (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {clubs.filter((c) => !c.isArchived).map((club) => {
                        const isSelected = formData.allowedClubs.includes(club.id);
                        return (
                          <div
                            key={club.id}
                            onClick={() => {
                              const current = formData.allowedClubs;
                              const next = isSelected
                                ? current.filter((id) => id !== club.id)
                                : [...current, club.id];
                              setFormData({ ...formData, allowedClubs: next });
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 16px",
                              borderRadius: 14,
                              background: isSelected ? "rgba(139,92,246,0.12)" : "var(--bg-elevated)",
                              border: `1px solid ${isSelected ? "rgba(139,92,246,0.5)" : "transparent"}`,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              minWidth: 80,
                            }}
                          >
                            <div style={{
                              width: 20,
                              height: 20,
                              borderRadius: 6,
                              background: isSelected ? "#8b5cf6" : "transparent",
                              border: `2px solid ${isSelected ? "#8b5cf6" : "var(--border-medium)"}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              transition: "all 0.15s",
                            }}>
                              {isSelected && <CheckCircle2 size={13} color="white" />}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? "#8b5cf6" : "var(--text-secondary)" }}>
                              {club.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedClubs.length === 0
                        ? "rgba(16,185,129,0.1)"
                        : "rgba(139,92,246,0.1)",
                      color: formData.allowedClubs.length === 0 ? "#10b981" : "#8b5cf6",
                      border: `1px solid ${formData.allowedClubs.length === 0 ? "rgba(16,185,129,0.2)" : "rgba(139,92,246,0.2)"}`,
                    }}>
                      {formData.allowedClubs.length === 0
                        ? (lang === "th" ? "✓ ไม่จำกัดตามชมรม" : "✓ No club restriction")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะสมาชิก: " : "Restricted to members of: "}${clubs.filter((c) => formData.allowedClubs.includes(c.id)).map((c) => c.name).join(", ")}`}
                    </div>
                  </div>
                </div>

                {/* Managed By — which president role(s) MANAGE this event (see it in
                    their admin list, view attendance, scan, export). Independent of
                    the role/major access above, which only controls who can JOIN.
                    admin/registration/organizer only — a president must never be
                    able to reassign who manages/owns their own event. */}
                <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "ผู้ดูแลกิจกรรม (ประธาน)" : "Managed By (President)"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกประธานที่ดูแลกิจกรรมนี้ (เห็นในรายการ ดูการเช็คอิน สแกน ส่งออก) — ไม่กระทบสิทธิ์การเข้าร่วมของนักศึกษา"
                      : "Choose which president(s) manage this event (view it, see attendance, scan, export). Does NOT affect which students can join."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(["club_president", "major_president"] as const).map((role) => {
                      const isSelected = formData.managedByRoles.includes(role);
                      const accent = role === "club_president" ? "#f59e0b" : "#06b6d4";
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.managedByRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, managedByRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: isSelected ? `${accent}1f` : "var(--bg-elevated)",
                            border: `1px solid ${isSelected ? `${accent}80` : "transparent"}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? accent : "transparent",
                            border: `2px solid ${isSelected ? accent : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? accent : "var(--text-secondary)" }}>
                            {ROLE_LABELS[role as ParticipantRole]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.managedByRoles.length === 0
                        ? "rgba(148,163,184,0.12)"
                        : "rgba(99,102,241,0.1)",
                      color: formData.managedByRoles.length === 0 ? "var(--text-muted)" : "#6366f1",
                      border: `1px solid ${formData.managedByRoles.length === 0 ? "var(--border-subtle)" : "rgba(99,102,241,0.2)"}`,
                    }}>
                      {formData.managedByRoles.length === 0
                        ? (lang === "th" ? "จัดการโดยทีมงานเท่านั้น" : "Staff-managed only")
                        : `✓ ${lang === "th" ? "ดูแลโดย: " : "Managed by: "}${formData.managedByRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>

                  {/* Owner club(s)/major(s) — WHICH club_president/major_president may
                      actually manage this event (see EventScopeService). Without an
                      owner assigned here, the event stays hidden from every president
                      even though managedByRoles marks it as president-managed. */}
                  {formData.managedByRoles.includes("club_president") && (
                    <div style={{ marginTop: 14 }}>
                      <label className="label" style={{ fontSize: 12 }}>
                        {lang === "th" ? "ชมรมที่เป็นเจ้าของกิจกรรม" : "Owning club(s)"}
                      </label>
                      {clubs.filter((c) => !c.isArchived).length === 0 ? (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                          {lang === "th" ? "ยังไม่มีชมรม — สร้างได้ที่ Admin > Clubs" : "No clubs yet — create one under Admin > Clubs."}
                        </p>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                          {clubs.filter((c) => !c.isArchived).map((club) => {
                            const isSelected = formData.ownerClubIds.includes(club.id);
                            return (
                              <div
                                key={club.id}
                                onClick={() => {
                                  const current = formData.ownerClubIds;
                                  const next = isSelected
                                    ? current.filter((id) => id !== club.id)
                                    : [...current, club.id];
                                  setFormData({ ...formData, ownerClubIds: next });
                                }}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 10,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  background: isSelected ? "rgba(245,158,11,0.15)" : "var(--bg-elevated)",
                                  color: isSelected ? "#f59e0b" : "var(--text-secondary)",
                                  border: `1px solid ${isSelected ? "rgba(245,158,11,0.4)" : "var(--border-subtle)"}`,
                                }}
                              >
                                {club.name}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {formData.ownerClubIds.length === 0 && (
                        <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginTop: 6 }}>
                          {lang === "th"
                            ? "⚠ ยังไม่ได้กำหนดชมรม — จะไม่แสดงกับประธานชมรมคนใดจนกว่าจะเลือก"
                            : "⚠ No club assigned yet — hidden from every club president until you pick one."}
                        </p>
                      )}
                    </div>
                  )}
                  {formData.managedByRoles.includes("major_president") && (
                    <div style={{ marginTop: 14 }}>
                      <label className="label" style={{ fontSize: 12 }}>
                        {lang === "th" ? "สาขาที่เป็นเจ้าของกิจกรรม" : "Owning major(s)"}
                      </label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                        {ALL_MAJORS.map((major) => {
                          const isSelected = formData.ownerMajors.includes(major);
                          return (
                            <div
                              key={major}
                              onClick={() => {
                                const current = formData.ownerMajors;
                                const next = isSelected
                                  ? current.filter((m) => m !== major)
                                  : [...current, major];
                                setFormData({ ...formData, ownerMajors: next });
                              }}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 10,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                background: isSelected ? "rgba(6,182,212,0.15)" : "var(--bg-elevated)",
                                color: isSelected ? "#06b6d4" : "var(--text-secondary)",
                                border: `1px solid ${isSelected ? "rgba(6,182,212,0.4)" : "var(--border-subtle)"}`,
                              }}
                            >
                              {major}
                            </div>
                          );
                        })}
                      </div>
                      {formData.ownerMajors.length === 0 && (
                        <p style={{ fontSize: 11, color: "#06b6d4", fontWeight: 700, marginTop: 6 }}>
                          {lang === "th"
                            ? "⚠ ยังไม่ได้กำหนดสาขา — จะไม่แสดงกับประธานสาขาคนใดจนกว่าจะเลือก"
                            : "⚠ No major assigned yet — hidden from every major president until you pick one."}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Event Staff — specific PEOPLE (any role, including plain
                    students) assigned to staff THIS event. Separate from
                    Managed By above (which is role-based, president-only):
                    this is a per-person list that exempts their own
                    registration/check-in from the event's quota and no-show
                    strikes (see events.staffUserIds in schema.ts). Staff-only
                    field, like Managed By. */}
                <div className="field" style={{ opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} style={{ color: "#6366f1" }} />
                    {lang === "th" ? "ทีมงานของกิจกรรมนี้" : "Event Staff"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกคนที่ช่วยดูแลกิจกรรมนี้โดยเฉพาะ (ไม่นับรวมในโควตาผู้เข้าร่วม และไม่ถูกตัดคะแนนขาดงาน)"
                      : "Pick specific people staffing this event. Their registration/check-in won't count against the participant quota and they're exempt from no-show strikes."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {formData.staffUserIds.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      {formData.staffUserIds.map((uid) => {
                        const u = assigneeUsers.find((x) => x.id === uid);
                        return (
                          <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 800, background: "rgba(99,102,241,0.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.25)" }}>
                            {u ? (u.name || u.studentId || uid) : uid}
                            <button type="button" disabled={!canEditRestrictedFields} onClick={() => setFormData({ ...formData, staffUserIds: formData.staffUserIds.filter((x) => x !== uid) })} style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontWeight: 900, fontSize: 13, lineHeight: 1 }}>✕</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", height: 42, borderRadius: 12, padding: "0 14px" }}
                    placeholder={lang === "th" ? "ค้นหาด้วยชื่อหรือรหัสนักศึกษา…" : "Search people by name or student ID…"}
                    value={staffAssigneeSearch}
                    onChange={(e) => setStaffAssigneeSearch(e.target.value)}
                    disabled={!canEditRestrictedFields}
                  />
                  {staffAssigneeSearch.trim().length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                      {assigneeUsers
                        .filter((u) => {
                          const q = staffAssigneeSearch.trim().toLowerCase();
                          return (u.name || "").toLowerCase().includes(q) || (u.studentId || "").toLowerCase().includes(q);
                        })
                        .slice(0, 30)
                        .map((u) => {
                          const on = formData.staffUserIds.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              disabled={!canEditRestrictedFields}
                              onClick={() => setFormData({
                                ...formData,
                                staffUserIds: on ? formData.staffUserIds.filter((x) => x !== u.id) : [...formData.staffUserIds, u.id],
                              })}
                              style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgba(99,102,241,0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                            >
                              <span style={{ fontWeight: 700 }}>{u.name || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {u.studentId || u.role}</span></span>
                              <span style={{ fontSize: 12, fontWeight: 900, color: on ? "#6366f1" : "var(--accent-primary)" }}>{on ? "✓ Added" : "+ Add"}</span>
                            </button>
                          );
                        })}
                      {assigneeUsers.length === 0 && (
                        <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>{lang === "th" ? "กำลังโหลดรายชื่อ…" : "Loading people…"}</p>
                      )}
                    </div>
                  )}
                  {formData.staffUserIds.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 10 }}>
                      {lang === "th" ? "ยังไม่ได้กำหนดทีมงาน" : "No one assigned as staff yet."}
                    </p>
                  )}
                </div>

                {/* "Also count for Songsue" — staff-only mirror toggle. See
                    events.songsueLinked in schema.ts / src/lib/songsue-sync.ts. */}
                <div className="field" style={{ marginTop: 20, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <div
                    onClick={() => set("songsueLinked", !formData.songsueLinked)}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.songsueLinked ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.songsueLinked ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.songsueLinked ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.1s"
                    }}>
                      {formData.songsueLinked && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <ExternalLink size={18} style={{ flexShrink: 0, color: formData.songsueLinked ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.songsueLinked ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.songsueLinkedLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {t.songsueLinkedHint}
                      </span>
                    </div>
                  </div>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, marginTop: 8 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {canEditRestrictedFields && editingId && formData.songsueLinked && (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ borderRadius: 12 }}
                        disabled={songsueResyncing}
                        onClick={resyncSongsue}
                      >
                        {songsueResyncing ? t.songsueResyncing : t.songsueResyncButton}
                      </button>
                      {songsueResyncMessage && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{songsueResyncMessage}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="field">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {t.eventPosterLabel}
                    {formData.imageUrls.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-primary)", background: "rgba(255,107,0,0.1)", padding: "2px 8px", borderRadius: 99 }}>
                        {formData.imageUrls.length}
                      </span>
                    )}
                  </label>

                  {/* Poster thumbnails — first one is the cover. Reorder with the
                      arrows; delete with the ×. */}
                  {formData.imageUrls.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12, marginBottom: 12 }}>
                      {formData.imageUrls.map((url, idx) => (
                        <div key={url + idx} style={{
                          position: "relative",
                          aspectRatio: "4/5",
                          borderRadius: 16,
                          overflow: "hidden",
                          background: "#000",
                          border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-medium)"
                        }}>
                          <img src={url} alt={`Poster ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />

                          {idx === 0 && (
                            <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontWeight: 900, color: "#fff", background: "var(--accent-primary)", padding: "3px 7px", borderRadius: 99, letterSpacing: "0.05em", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
                              {lang === "th" ? "ปก" : "COVER"}
                            </span>
                          )}

                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => removePoster(idx)}
                            title={lang === "th" ? "ลบ" : "Remove"}
                            style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}
                          >
                            <X size={14} />
                          </button>

                          {/* Reorder */}
                          <div style={{ position: "absolute", bottom: 6, left: 6, right: 6, display: "flex", justifyContent: "space-between", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => movePoster(idx, -1)}
                              disabled={idx === 0}
                              title={lang === "th" ? "ย้ายไปด้านหน้า" : "Move left"}
                              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.35 : 1, backdropFilter: "blur(4px)" }}
                            >
                              <ChevronLeft size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePoster(idx, 1)}
                              disabled={idx === formData.imageUrls.length - 1}
                              title={lang === "th" ? "ย้ายไปด้านหลัง" : "Move right"}
                              style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === formData.imageUrls.length - 1 ? "not-allowed" : "pointer", opacity: idx === formData.imageUrls.length - 1 ? 0.35 : 1, backdropFilter: "blur(4px)" }}
                            >
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload dropzone — accepts multiple files at once. */}
                  <div style={{
                    position: "relative",
                    height: formData.imageUrls.length > 0 ? 110 : 180,
                    background: "var(--bg-elevated)",
                    borderRadius: 20,
                    border: "2px dashed var(--border-medium)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    cursor: posterUploading > 0 ? "wait" : "pointer",
                    transition: "all 0.2s"
                  }} onClick={() => { if (posterUploading === 0) document.getElementById("poster-upload")?.click(); }}>
                    {posterUploading > 0 ? (
                      <div style={{ textAlign: "center", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                        <RefreshCw size={24} className="animate-spin" style={{ color: "var(--accent-primary)" }} />
                        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                          {lang === "th" ? `กำลังอัปโหลด ${posterUploading} ไฟล์...` : `Uploading ${posterUploading} image${posterUploading > 1 ? "s" : ""}...`}
                        </p>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", padding: 20 }}>
                        <div style={{ width: formData.imageUrls.length > 0 ? 44 : 64, height: formData.imageUrls.length > 0 ? 44 : 64, borderRadius: "50%", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", color: "var(--text-muted)" }}>
                          <Plus size={formData.imageUrls.length > 0 ? 22 : 28} />
                        </div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
                          {formData.imageUrls.length > 0
                            ? (lang === "th" ? "เพิ่มโปสเตอร์" : "Add more posters")
                            : (lang === "th" ? "อัปโหลดโปสเตอร์ (เลือกได้หลายไฟล์)" : "Upload Posters (select multiple)")}
                        </p>
                        {formData.imageUrls.length === 0 && (
                          <>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>
                              {lang === "th" ? "แนะนำขนาด 1080x1080px (อัตราส่วน 1:1)" : "Recommended: 1080x1080px (1:1 Ratio)"}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              {lang === "th" ? "ขนาดไฟล์สูงสุด 10MB (ระบบจะบีบอัดอัตโนมัติ)" : "Max file size: 10MB (Auto-compressed)"}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    <input
                      type="file"
                      id="poster-upload"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        await addPosters(files);
                        // Allow re-selecting the same file(s) after a removal.
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {formData.imageUrls.length > 1 && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, fontWeight: 600 }}>
                      {lang === "th"
                        ? "นักศึกษาสามารถปัดดูโปสเตอร์ทั้งหมดได้ในหน้าแดชบอร์ด • โปสเตอร์แรกคือภาพปก"
                        : "Students can swipe through all posters on the dashboard • the first poster is the cover."}
                    </p>
                  )}
                </div>

                <div className="field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <label className="label" style={{ marginBottom: 0 }}>{t.eventDescriptionLabel}</label>
                    <div style={{ display: "flex", gap: 4, background: "var(--bg-elevated)", padding: 2, borderRadius: 10 }}>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("**", "**")}><Edit2 size={14} /></button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("[", "](https://...)")}><ExternalLink size={14} /></button>
                      <div style={{ position: "relative" }}>
                        <input type="color" defaultValue="#ff6b00" style={{ opacity: 0, position: "absolute", inset: 0, cursor: "pointer" }} onChange={(e) => injectMarkup(`{{color:${e.target.value}|`, "}}")} />
                        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }}>
                          <span style={{ width: 14, height: 14, borderRadius: 4, background: "linear-gradient(135deg,#ef4444,#6366f1)", display: "inline-block" }} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-auto md:h-[240px]">
                    <textarea
                      ref={textareaRef}
                      className="input h-[180px] md:h-full"
                      style={{ resize: "none", borderRadius: 16, background: "var(--bg-elevated)", border: "none", fontSize: 14, padding: 16 }}
                      value={formData.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder={lang === "th" ? "อธิบายรายละเอียดเกี่ยวกับกิจกรรม..." : "Tell them about the event..."}
                    />
                    <div
                      className="custom-scrollbar h-[180px] md:h-full"
                      style={{
                        background: "var(--bg-elevated)",
                        borderRadius: 16,
                        padding: 16,
                        fontSize: 14,
                        lineHeight: 1.6,
                        overflowY: "auto",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-subtle)"
                      }}
                    >
                      <p style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.05em" }}>{lang === "th" ? "ตัวอย่างการแสดงผล" : "Live Preview"}</p>
                      <div dangerouslySetInnerHTML={{ __html: parseRichText(formData.description) || `<span style="color: var(--text-muted); font-style: italic;">${lang === "th" ? "ยังไม่มีเนื้อหา..." : "No content yet..."}</span>` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6" style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {error && <div style={{ color: "#ef4444", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><AlertCircle size={16} /> {error}</div>}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 w-full sm:w-auto">
                <button type="button" className="btn btn-ghost btn-lg w-full sm:w-auto" style={{ borderRadius: 16 }} onClick={() => { setShowForm(false); setEditingId(null); setFormData(EMPTY_FORM); setSourceProposalId(null); setRegistrationMode(null); setSessions([]); }}>{t.discardBtn}</button>
                <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto" style={{ borderRadius: 16, minWidth: 200 }} disabled={submitting}>
                  {submitting ? <>{lang === "th" ? "กำลังบันทึก..." : "Saving..."}</> : editingId ? t.updateSystemBtn : t.activateEventBtn}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Events Grid */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "100px 0", gap: 20 }}>
          <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
          <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>Loading Event Records...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div style={{
          background: "var(--bg-surface)",
          borderRadius: 40,
          padding: 80,
          textAlign: "center",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24
        }}>
          <div style={{ width: 120, height: 120, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <Calendar size={48} />
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 800 }}>{t.noEventsFoundLabel}</h3>
            <p style={{ color: "var(--text-muted)", marginTop: 8 }}>{lang === "th" ? "ลองปรับตัวกรองหรือสร้างกิจกรรมใหม่เพื่อเริ่มต้น" : lang === "cn" ? "尝试调整您的筛选条件或创建一个新活动以开始。" : lang === "mm" ? "စတင်ရန် စစ်ထုတ်မှုများကို ချိန်ညှိပါ သို့မဟုတ် ပွဲအသစ်တစ်ခု ဖန်တီးပါ။" : "Try adjusting your filters or create a new event to get started."}</p>
          </div>
          {!isAttendanceOnly && (
            <button className="btn btn-primary" onClick={() => {
              setEditingId(null); setFormData(EMPTY_FORM); setSourceProposalId(null); setRegistrationMode(null); setSessions([{ title: "", startTime: "", endTime: "", quotaWalkIn: null }]); setShowForm(true);
              ensureAssigneeUsersLoaded();
            }}>+ {t.addEventBtn}</button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 32 }}>
          {filteredEvents.map((evt) => {
            const status = getEventStatus(evt);
            const isLive = status === "live";
            const isPast = status === "past";

            return (
              <div key={evt.id} className="event-card-premium" style={{
                background: isPast ? "var(--bg-elevated)" : "var(--bg-surface)",
                borderRadius: 32,
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                position: "relative",
                boxShadow: "0 10px 40px rgba(0,0,0,0.04)",
                filter: isPast ? "grayscale(0.85)" : "none",
                opacity: isPast ? 0.6 : 1
              }}>
                {/* Card Header (Image/Status) */}
                <div style={{ height: 220, position: "relative", background: "var(--bg-elevated)", padding: 16 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 20, overflow: "hidden", position: "relative" }}>
                    {evt.imageUrl ? (
                      <img src={evt.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, var(--bg-elevated) 0%, var(--border-subtle) 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Calendar size={48} style={{ color: "var(--accent-primary)", opacity: 0.2 }} />
                      </div>
                    )}
                  </div>

                  {/* Top overlays: role/major restriction badges (left) and status
                      badges (right) live in ONE flex row that wraps, so they never
                      overlap on narrow / mobile cards (was: two independent absolute
                      blocks both anchored top:28, which collided when the card shrank). */}
                  <div className="event-card-overlay" style={{ position: "absolute", top: 28, left: 28, right: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    {/* Restriction badges (role + major), stacked */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", minWidth: 0, flexShrink: 1 }}>
                      {evt.allowedRoles && evt.allowedRoles.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgba(99,102,241,0.85)",
                          backdropFilter: "blur(6px)",
                          color: "#fff",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgba(255,255,255,0.15)",
                          boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
                          textTransform: "uppercase",
                        }}>
                          <Users size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r.toUpperCase()).join(" • ")}
                          </span>
                        </div>
                      )}
                      {evt.allowedMajors && evt.allowedMajors.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgba(255,107,0,0.85)",
                          backdropFilter: "blur(6px)",
                          color: "#fff",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgba(255,255,255,0.15)",
                          boxShadow: "0 2px 8px rgba(255,107,0,0.3)",
                          textTransform: "uppercase",
                        }}>
                          <Users size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.allowedMajors.join(" • ")}
                          </span>
                        </div>
                      )}
                      {evt.allowedClubs && evt.allowedClubs.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgba(139,92,246,0.85)",
                          backdropFilter: "blur(6px)",
                          color: "#fff",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgba(255,255,255,0.15)",
                          boxShadow: "0 2px 8px rgba(139,92,246,0.3)",
                          textTransform: "uppercase",
                        }}>
                          <Building2 size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.allowedClubs!
                              .map((id) => clubs.find((c) => c.id === id)?.name || id)
                              .join(" • ")}
                          </span>
                        </div>
                      )}
                      {evt.firstYearOnly && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgba(16,185,129,0.85)",
                          backdropFilter: "blur(6px)",
                          color: "#fff",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgba(255,255,255,0.15)",
                          boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
                          textTransform: "uppercase",
                        }}>
                          <GraduationCap size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.firstYearBadge}
                          </span>
                        </div>
                      )}
                      {/* Managed-by badge — which president manages this event
                          (admin context only; independent of participant access). */}
                      {evt.managedByRoles && evt.managedByRoles.length > 0 && (
                        <div className="event-card-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          maxWidth: "100%",
                          background: "rgba(15,23,42,0.78)",
                          backdropFilter: "blur(6px)",
                          color: "#fff",
                          padding: "5px 10px",
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 900,
                          letterSpacing: "0.04em",
                          border: "1px solid rgba(255,255,255,0.15)",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                          textTransform: "uppercase",
                        }}>
                          <ShieldCheck size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.managedByRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r.toUpperCase()).join(" • ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Status badges */}
                    <div className="event-card-status" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0, flexShrink: 1, marginLeft: "auto" }}>
                      {evt.walkInsEnabled && (
                        <div className="badge" style={{ background: "rgba(99, 102, 241, 0.2)", color: "#6366f1", border: "1px solid rgba(99, 102, 241, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          <Zap size={12} style={{ marginRight: 4 }} />
                          Walk-in
                        </div>
                      )}
                      {(evt.targetThai !== false && evt.targetInternational !== false) || (evt.targetThai === false && evt.targetInternational === false) ? (
                        <div className="badge" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          All Students
                        </div>
                      ) : evt.targetThai !== false ? (
                        <div className="badge" style={{ background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", border: "1px solid rgba(59, 130, 246, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          Thai Only
                        </div>
                      ) : evt.targetInternational !== false ? (
                        <div className="badge" style={{ background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.3)", padding: "6px 12px", backdropFilter: "blur(4px)" }}>
                          {"Int'l Only"}
                        </div>
                      ) : null}
                      {/* Discoverability for the staff diff banner (see events.
                          pendingDetailsChanges in schema.ts): the diff itself only
                          renders inside the edit form once opened, so without this
                          badge staff have no way to tell a president edit is
                          waiting for review short of opening every event's editor.
                          Clicking jumps straight into the edit form via handleEdit,
                          which auto-scrolls to formRef where the diff banner lives. */}
            {/* Requires an actual pendingDetailsChanges diff, not just the status
                          flag — a stale/defaulted 'pending' status with no diff (e.g.
                          a pre-existing event backfilled by the details_review_status
                          column's DEFAULT 'pending', see drizzle/0030_backfill_details_review_status.sql)
                          must never show this badge. */}
                      {!isAttendanceOnly && evt.detailsReviewStatus === "pending" && evt.pendingDetailsChanges && (
                        <button
                          type="button"
                          onClick={() => handleEdit(evt)}
                          className="badge animate-pulse-glow"
                          style={{ background: "#f59e0b", color: "#fff", border: "none", padding: "6px 12px", cursor: "pointer" }}
                        >
                          <AlertTriangle size={12} style={{ marginRight: 4 }} />
                          {t.eventDetailsPendingStaffLabel || "President edited this event"}
                        </button>
                      )}
                      {isLive && (
                        <div className="badge animate-pulse-glow" style={{ background: "#10b981", color: "#fff", border: "none", padding: "6px 12px" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", marginRight: 6 }} />
                          {t.statusLive.toUpperCase()}
                        </div>
                      )}
                      {!isLive && !isPast && (
                        <div className="badge" style={{ background: "var(--accent-primary)", color: "#fff", border: "none", padding: "6px 12px" }}>{t.statusUpcoming.toUpperCase()}</div>
                      )}
                      {isPast && (
                        <div className="badge" style={{ background: "rgba(0,0,0,0.4)", color: "#fff", border: "none", padding: "6px 12px", backdropFilter: "blur(4px)" }}>{t.statusPast.toUpperCase()}</div>
                      )}
                    </div>
                  </div>

                  {/* Points Badges — house (winner bonus) and, when set, per-attendee individual */}
                  <div style={{ position: "absolute", bottom: 28, left: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {evt.pointsAwarded !== undefined && (
                      <div style={{
                        background: "rgba(0, 0, 0, 0.7)",
                        backdropFilter: "blur(8px)",
                        color: "#fff",
                        padding: "6px 12px",
                        borderRadius: 14,
                        fontSize: 11,
                        fontWeight: 900,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        border: "1px solid rgba(255, 255, 255, 0.1)"
                      }} title={t.eventHousePointsHint}>
                        <Trophy size={12} style={{ color: "#fbbf24" }} />
                        <span>{evt.pointsAwarded} PTS</span>
                      </div>
                    )}
                    {evt.individualPointsAwarded > 0 && (
                      <div style={{
                        background: "rgba(0, 0, 0, 0.7)",
                        backdropFilter: "blur(8px)",
                        color: "#fff",
                        padding: "6px 12px",
                        borderRadius: 14,
                        fontSize: 11,
                        fontWeight: 900,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                        border: "1px solid rgba(255, 255, 255, 0.1)"
                      }} title={t.eventIndividualPointsHint}>
                        <Sparkles size={12} style={{ color: "var(--accent-primary)" }} />
                        <span>+{evt.individualPointsAwarded} {t.eventIndividualPointsBadge}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Content */}
                <div style={{ padding: "28px", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.35, overflowWrap: "break-word", wordBreak: "break-word" }}>{evt.title}</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
                        <MapPin size={14} style={{ color: "var(--accent-primary)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.location || "Online / TBD"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                        <Calendar size={14} style={{ color: "var(--accent-primary)" }} />
                        {(() => {
                          const start = new Date(evt.startTime);
                          const end = new Date(evt.endTime);
                          const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                          const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                          
                          const startDateStr = start.toLocaleDateString('en-GB', dateOpts);
                          const endDateStr = end.toLocaleDateString('en-GB', dateOpts);
                          const startTimeStr = start.toLocaleTimeString('en-GB', timeOpts);
                          const endTimeStr = end.toLocaleTimeString('en-GB', timeOpts);

                          if (startDateStr === endDateStr) {
                            return `${startDateStr} ${startTimeStr} - ${endTimeStr}`;
                          } else {
                            return `${startDateStr} ${startTimeStr} - ${endDateStr} ${endTimeStr}`;
                          }
                        })()}
                      </div>
                      {evt.registrationCloseTime && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                          <Clock size={14} style={{ color: "var(--accent-primary)" }} />
                          <span>
                            {t.eventRegistrationCloseLabel}: {(() => {
                              const closeDate = new Date(evt.registrationCloseTime);
                              const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
                              const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' };
                              return `${closeDate.toLocaleDateString('en-GB', dateOpts)} ${closeDate.toLocaleTimeString('en-GB', timeOpts)}`;
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card-level diff preview for staff — shows what a president
                      changed (old -> new) right on the card, so staff don't have
                      to open the edit form just to see what's pending. Computed
                      straight from evt (AdminEvent already carries the live
                      values + pendingDetailsChanges), independent of the fuller
                      banner inside the edit form below. */}
                  {!isAttendanceOnly && evt.detailsReviewStatus === "pending" && evt.pendingDetailsChanges && (() => {
                    const diffRows = formatPendingDetailsDiff(evt.pendingDetailsChanges!, evt, t);
                    if (diffRows.length === 0) return null;
                    return (
                      <div style={{
                        display: "flex", flexDirection: "column", gap: 6,
                        background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)",
                        borderRadius: 14, padding: "12px 14px", marginBottom: 20,
                      }}>
                        {evt.pendingSubmitter && (
                          <p style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b", margin: 0 }}>
                            {t.eventDetailsPendingSubmittedByLabel || "Submitted by:"} {evt.pendingSubmitter.name}
                          </p>
                        )}
                        {diffRows.map((row) => (
                          <p key={row.key} style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                            <strong style={{ color: "var(--text-primary)" }}>{row.label}:</strong>{" "}
                            {row.oldText} <span style={{ color: "#f59e0b", fontWeight: 700 }}>→</span> {row.newText}
                          </p>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Quota Progress */}
                  <div style={{ marginTop: "auto", marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 900, marginBottom: 6 }}>
                      <span style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.thQuota.toUpperCase()}</span>
                      <span style={{ color: "var(--text-primary)" }}>
                        {evt.attendeeCount || 0} / {evt.quota || "∞"}
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 8, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                      <div style={{
                        width: `${evt.quota ? Math.min(100, ((evt.attendeeCount || 0) / evt.quota) * 100) : 0}%`,
                        height: "100%",
                        background: evt.quota && (evt.attendeeCount || 0) >= evt.quota ? "var(--red-house)" : "var(--accent-primary)",
                        borderRadius: 99,
                        transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)"
                      }} />
                    </div>
                    {((evt.quotaThai !== null && evt.quotaThai > 0) || (evt.quotaInternational !== null && evt.quotaInternational > 0) || (evt.quotaWalkIn !== null && evt.quotaWalkIn > 0)) && (
                      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", flexWrap: "wrap" }}>
                        {evt.quotaThai !== null && evt.quotaThai > 0 && (
                          <span>Thai Limit: <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaThai}</strong></span>
                        )}
                        {evt.quotaInternational !== null && evt.quotaInternational > 0 && (
                          <span>{"Int'l Limit:"} <strong style={{ color: "var(--text-secondary)" }}>{evt.quotaInternational}</strong></span>
                        )}
                        {evt.quotaWalkIn !== null && evt.quotaWalkIn > 0 && (
                          <span>Walk-in (extra): <strong style={{ color: "var(--text-secondary)" }}>+{evt.quotaWalkIn}</strong></span>
                        )}
                      </div>
                    )}
                  </div>

                   {/* Actions */}
                   <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
                     <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                       <button
                         className="btn btn-primary"
                         style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                         onClick={() => viewAttendance(evt.id)}
                       >
                         <BarChart3 size={15} /> {lang === "th" ? "การเช็คอิน" : lang === "cn" ? "签到情况" : lang === "mm" ? "ချက်အင်ဝင်ရောက်မှု" : "Attendance"}
                       </button>
                       {canViewForms && (
                       <button
                          className="btn"
                          style={{
                            flex: 1,
                            height: 44,
                            borderRadius: 12,
                            fontSize: 13,
                            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                            color: "#fff",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            boxShadow: "0 4px 12px rgba(79, 70, 229, 0.2)",
                            cursor: "pointer"
                          }}
                          onClick={() => openFormBuilder(evt.id, evt.title)}
                        >
                          <ClipboardList size={14} /> {lang === "th" ? "แบบประเมิน" : lang === "cn" ? "评估表单" : lang === "mm" ? "အကဲဖြတ်ပုံစံ" : "Feedback Form"}
                        </button>
                        )}
                     </div>
                     {(canEditEventDetails || !isAttendanceOnly) && (
                     <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                       {canEditEventDetails && (
                       <button
                         className="btn btn-ghost"
                         style={{ flex: 1, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(0,0,0,0.03)", fontSize: 13 }}
                         onClick={() => handleEdit(evt)}
                       >
                         <Edit2 size={13} /> {t.eventEditBtnLabel || "Edit"}
                       </button>
                       )}
                       {!isAttendanceOnly && (
                       <button
                         id={`delete-event-${evt.id}-btn`}
                         className="btn btn-danger"
                         style={{ flex: 1, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13 }}
                         disabled={deletingId === evt.id}
                         onClick={() => handleDelete(evt.id)}
                       >
                         {deletingId === evt.id ? <div className="spinner w-4 h-4 border-2" /> : <Trash2 size={13} />} {t.eventDeleteBtnLabel || "Delete"}
                       </button>
                       )}
                     </div>
                     )}
                   </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Global CSS for the premium experience */}
      <style jsx global>{`
        .event-card-premium:hover {
          transform: translateY(-8px);
          border-color: var(--accent-primary);
          box-shadow: 0 30px 60px rgba(255,107,0,0.1);
        }
        .event-card-premium:hover .hover-overlay {
          opacity: 1;
        }
        .attendance-card:hover {
          transform: scale(1.02);
          border-color: var(--accent-primary);
          background: var(--bg-elevated);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-medium);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }

        /* Attendance Modal Responsive Styles */
        .attendance-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(16px);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(12px, 3vw, 24px);
        }
        .attendance-modal-container {
          background: var(--bg-surface);
          width: 100%;
          max-width: 1100px;
          max-height: 90vh;
          border-radius: clamp(20px, 4vw, 40px);
          padding: 0;
          /* The whole modal scrolls as one column. Only the header is pinned
             (sticky), so the summary + filters scroll away and the roster gets
             the full height instead of being squeezed by tall fixed chrome. */
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-medium);
          box-shadow: 0 50px 120px rgba(0,0,0,0.4);
          position: relative;
        }
        .attendance-modal-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: linear-gradient(to right, var(--bg-surface), var(--bg-elevated));
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .attendance-modal-header h2 {
          font-size: clamp(18px, 4vw, 28px);
          font-weight: 900;
          letter-spacing: -0.04em;
          margin: 0;
        }
        .attendance-modal-close-btn {
          border-radius: 50%;
          width: 40px;
          height: 40px;
          padding: 0;
          font-size: 20px;
          flex-shrink: 0;
        }
        .attendance-modal-actions-bar {
          padding: 12px 20px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .attendance-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex: 1 1 0;
          min-width: 0;
          border-radius: 99px;
          height: 40px;
          padding-inline: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .attendance-modal-filter-bar {
          padding: 12px 20px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .attendance-modal-list {
          padding: 20px;
        }

        @media (min-width: 1024px) {
          .attendance-modal-header {
            padding: 24px 40px;
          }
          .attendance-modal-header h2 {
            font-size: 32px;
          }
          .attendance-modal-close-btn {
            width: 48px;
            height: 48px;
          }
          .attendance-modal-actions-bar {
            padding: 16px 40px;
            gap: 10px;
          }
          .attendance-action-btn {
            flex: 0 0 auto;
            height: 48px;
            padding-inline: 20px;
            font-size: 14px;
            gap: 8px;
          }
          .attendance-modal-filter-bar {
            padding: 16px 40px;
            gap: 16px;
          }
          .attendance-modal-list {
            padding: 40px;
          }
        }
      `}</style>
      </div>

      {/* Evaluation Form Builder Modal */}
      {showFormBuilder && formEventId && (
        <EventFormBuilderModal
          eventId={formEventId}
          eventTitle={formEventTitle || "Event"}
          onClose={() => { setShowFormBuilder(false); setFormEventId(null); setFormEventTitle(null); }}
          onChanged={fetchEvents}
        />
      )}

      {/* Premium custom Confirm Modal */}
      {confirmModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: confirmModal.isDanger ? "rgba(239, 68, 68, 0.1)" : "rgba(255, 107, 0, 0.1)",
              color: confirmModal.isDanger ? "#ef4444" : "var(--accent-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <AlertCircle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {confirmModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {confirmModal.message}
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 700 }}
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              >
                {confirmModal.cancelText || "Cancel"}
              </button>
              <button
                className="btn"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  background: confirmModal.isDanger 
                    ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" 
                    : "linear-gradient(135deg, #ff6b00 0%, #ff3d00 100%)",
                  color: "#fff",
                  border: "none",
                  boxShadow: confirmModal.isDanger 
                    ? "0 4px 14px rgba(239, 68, 68, 0.3)" 
                    : "0 4px 14px rgba(255, 107, 0, 0.3)"
                }}
                onClick={confirmModal.onConfirm}
              >
                {confirmModal.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premium custom Error Modal */}
      {errorModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2500,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <X size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {errorModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {errorModal.message}
            </p>
            <button
              className="btn btn-ghost"
              style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800, border: "1px solid var(--border-medium)" }}
              onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "ปิด" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* Informational "pending review" notice — see reviewNoticeModal above. */}
      {reviewNoticeModal.show && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          zIndex: 2500,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setReviewNoticeModal(prev => ({ ...prev, show: false }))}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "90%",
            maxWidth: 440,
            borderRadius: 28,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(245, 158, 11, 0.1)",
              color: "#f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px"
            }}>
              <AlertTriangle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              {reviewNoticeModal.title}
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              {reviewNoticeModal.message}
            </p>
            <button
              className="btn btn-primary"
              style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 14, fontWeight: 800 }}
              onClick={() => setReviewNoticeModal(prev => ({ ...prev, show: false }))}
            >
              {lang === "th" ? "รับทราบ" : "Got it"}
            </button>
          </div>
        </div>
      )}

      {/* Attendance Modal */}
      {showAttendance && (
        <div className="attendance-modal-overlay">
          <div className="animate-fade-in-up attendance-modal-container">
            {/* Modal Header — slim & sticky so the roster gets maximum height.
                Export/Strike live in the non-sticky action bar below instead
                of here, so this bar's height stays fixed on mobile (they used
                to crowd this row and blow up the sticky header's height,
                burying the roster below the fold). */}
            <div className="attendance-modal-header">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "#10b981",
                    boxShadow: "0 0 12px rgba(16,185,129,0.6)",
                    animation: "pulse-glow 2s infinite",
                    flexShrink: 0,
                  }} />
                  <h2 style={{ fontWeight: 900, letterSpacing: "-0.04em", overflowWrap: "break-word", wordBreak: "break-word", whiteSpace: "normal", lineHeight: 1.25, minWidth: 0 }}>
                    {activeEvent?.title || "Attendance List"}
                  </h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, paddingLeft: 20 }}>
                  <Users size={15} className="text-muted" />
                  <p style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 14 }}>
                    <span style={{ color: "var(--text-primary)", fontWeight: 800 }}>{checkInCount}</span> / <span style={{ color: "var(--text-primary)", fontWeight: 800 }}>{registeredCount}</span> {lang === "th" ? "เช็คอินแล้ว" : lang === "cn" ? "已签到" : lang === "mm" ? "ချက်အင်ပြီး" : "checked in"}
                  </p>
                </div>
              </div>
              <button
                className="btn btn-ghost attendance-modal-close-btn"
                onClick={() => setShowAttendance(false)}
              >
                <X size={20} />
              </button>
            </div>

            {/* Action bar — Export / Strike. Not sticky, so it scrolls away
                with the summary + filters and never competes with the roster
                for screen height; wraps to its own compact row on mobile. */}
            {(showExportButton || showStrikeButton) && (
              <div className="attendance-modal-actions-bar">
                {showExportButton && (
                  <button
                    className="attendance-action-btn"
                    onClick={exportAttendanceXlsx}
                    title={
                      canSeeRawMedicalDetail
                        ? "Export all attendees of this event to Excel (.xlsx)"
                        : "Export attendees to Excel (.xlsx) — name, ID, and check-in only. Ask an admin for phone, medical, or emergency-contact detail."
                    }
                    style={{
                      color: "#fff",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      border: "1px solid #059669",
                      boxShadow: "0 8px 20px rgba(16,185,129,0.35)",
                    }}
                  >
                    <Download size={16} />
                    {lang === "th" ? "ส่งออก Excel" : "Export Excel"}
                  </button>
                )}
                {showStrikeButton && (
                  <button
                    className="attendance-action-btn"
                    onClick={openStrikesModal}
                    title="Deduct points and record a strike for every student who registered but never checked in"
                    style={{
                      color: "#fff",
                      background: "linear-gradient(135deg, #ef4444, #dc2626)",
                      border: "1px solid #dc2626",
                      boxShadow: "0 8px 20px rgba(239,68,68,0.35)",
                    }}
                  >
                    <AlertTriangle size={16} />
                    {lang === "th" ? "ลงโทษผู้ไม่มา" : "Strike No-shows"}
                  </button>
                )}
              </div>
            )}

            {/* Summary tiles — at-a-glance breakdown for the day in view, mirroring
                the exported report's Summary sheet. */}
            {!loadingAttendance && attendance.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 12,
                  padding: "12px 20px 8px",
                }}
              >
                {attendanceSummaryTiles.map((tile) => (
                  <div
                    key={tile.key}
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 14,
                      padding: "14px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{tile.label}</span>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 26, fontWeight: 900, color: tile.color, letterSpacing: "-0.03em" }}>{tile.value}</span>
                      {tile.sub && (
                        <span style={{ fontSize: 13, fontWeight: 700, color: tile.color, opacity: 0.85 }}>({tile.sub})</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Filter Bar */}
            {!loadingAttendance && attendance.length > 0 && (
              <div className="attendance-modal-filter-bar">
                {/* Per-day picker — only for true multi-day events. Lets the admin
                    view (and export) one day at a time, so the same person who
                    attended several days isn't read as duplicate people. */}
                {isMultiDayEvent && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "var(--text-muted)", marginRight: 2 }}>
                      <Calendar size={15} />
                      {lang === "th" ? "วัน" : lang === "cn" ? "日期" : lang === "mm" ? "နေ့" : "Day"}:
                    </span>
                    {[{ id: null as string | null, label: lang === "th" ? "ทุกวัน" : lang === "cn" ? "全部" : lang === "mm" ? "အားလုံး" : "All days" },
                      ...activeEventSessions.map((s) => ({
                        id: s.id as string | null,
                        label: s.title?.trim() || `${lang === "th" ? "วันที่" : lang === "cn" ? "第" : lang === "mm" ? "နေ့" : "Day"} ${s.sortOrder + 1}`,
                      }))].map((opt) => {
                      const active = selectedSessionId === opt.id;
                      return (
                        <button
                          key={opt.id ?? "all"}
                          onClick={() => setSelectedSessionId(opt.id)}
                          style={{
                            padding: "7px 14px",
                            borderRadius: 99,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            border: active ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                            background: active ? "var(--accent-glow)" : "var(--bg-surface)",
                            color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  {/* Filtering to condition-holders is signal-level (who, not
                      what), so it's available to all STAFF admin roles and a
                      president viewing their own event — but not smo, whose
                      thin roster has no medical signal to filter on. */}
                  {canSeeAttendeeContactAndMedical && (
                  <button
                    onClick={() => setFilterMedical(!filterMedical)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterMedical ? "1px solid #ef4444" : "1px solid var(--border-subtle)",
                      background: filterMedical ? "rgba(239, 68, 68, 0.1)" : "var(--bg-surface)",
                      color: filterMedical ? "#ef4444" : "var(--text-secondary)"
                    }}
                  >
                    <HeartPulse size={16} />
                    {filterMedical ? "Showing: Medical Conditions Only" : "Filter: Medical Conditions Only"}
                  </button>
                  )}

                  <button
                    onClick={() => setFilterNotCheckedIn(!filterNotCheckedIn)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterNotCheckedIn ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      background: filterNotCheckedIn ? "var(--accent-glow)" : "var(--bg-surface)",
                      color: filterNotCheckedIn ? "var(--accent-primary)" : "var(--text-secondary)"
                    }}
                  >
                    <Clock size={16} />
                    {filterNotCheckedIn ? "Showing: Not Checked In Only" : "Filter: Not Checked In Only"}
                  </button>

                  {/* Strike count is not PDPA-sensitive (unlike medical), so both
                      no-show filters stay visible to attendance-only roles (smo,
                      club/major president) — not gated behind !isAttendanceOnly. */}
                  <button
                    onClick={() => setFilterStrikeHistory(!filterStrikeHistory)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterStrikeHistory ? "1px solid #ef4444" : "1px solid var(--border-subtle)",
                      background: filterStrikeHistory ? "rgba(239, 68, 68, 0.1)" : "var(--bg-surface)",
                      color: filterStrikeHistory ? "#ef4444" : "var(--text-secondary)"
                    }}
                  >
                    <AlertCircle size={16} />
                    {filterStrikeHistory ? "Showing: Has Strike History" : "Filter: Has Strike History"}
                  </button>

                  <button
                    onClick={() => setFilterEventNoShow(!filterEventNoShow)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterEventNoShow ? "1px solid #ef4444" : "1px solid var(--border-subtle)",
                      background: filterEventNoShow ? "rgba(239, 68, 68, 0.1)" : "var(--bg-surface)",
                      color: filterEventNoShow ? "#ef4444" : "var(--text-secondary)"
                    }}
                  >
                    <AlertTriangle size={16} />
                    {filterEventNoShow ? "Showing: No-Show This Event" : "Filter: No-Show This Event"}
                  </button>

                  <button
                    onClick={() => setFilterStudentsOnly(!filterStudentsOnly)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterStudentsOnly ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      background: filterStudentsOnly ? "var(--accent-glow)" : "var(--bg-surface)",
                      color: filterStudentsOnly ? "var(--accent-primary)" : "var(--text-secondary)"
                    }}
                  >
                    <User size={16} />
                    {filterStudentsOnly ? "Showing: Students Only" : "Filter: Students Only"}
                  </button>

                  <button
                    onClick={() => setFilterMaster(!filterMaster)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterMaster ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      background: filterMaster ? "var(--accent-glow)" : "var(--bg-surface)",
                      color: filterMaster ? "var(--accent-primary)" : "var(--text-secondary)"
                    }}
                  >
                    <GraduationCap size={16} />
                    {filterMaster ? "Showing: Master's Degree" : "Filter: Master's Degree"}
                  </button>

                  <button
                    onClick={() => setFilterPhd(!filterPhd)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 99,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      border: filterPhd ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      background: filterPhd ? "var(--accent-glow)" : "var(--bg-surface)",
                      color: filterPhd ? "var(--accent-primary)" : "var(--text-secondary)"
                    }}
                  >
                    <GraduationCap size={16} />
                    {filterPhd ? "Showing: Ph.D Degree" : "Filter: Ph.D Degree"}
                  </button>

                  {([1, 2, 3, 4, 5] as const).map((yr) => {
                    const active = yearFilter.has(yr);
                    return (
                      <button
                        key={yr}
                        onClick={() => {
                          setYearFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(yr)) next.delete(yr); else next.add(yr);
                            return next;
                          });
                        }}
                        style={{
                          padding: "8px 16px",
                          borderRadius: 99,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          transition: "all 0.2s",
                          border: active ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                          background: active ? "var(--accent-glow)" : "var(--bg-surface)",
                          color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                        }}
                      >
                        {yr === 5 ? "Yr 5+" : `Yr ${yr}`}
                      </button>
                    );
                  })}

                  <label style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    color: filterThai ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: 99,
                    background: filterThai ? "rgba(255, 107, 0, 0.08)" : "var(--bg-surface)",
                    border: filterThai ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    transition: "all 0.2s"
                  }}>
                    <input
                      type="checkbox"
                      checked={filterThai}
                      onChange={(e) => setFilterThai(e.target.checked)}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15, cursor: "pointer" }}
                    />
                    Thai Students
                  </label>

                  <label style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    color: filterInternational ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: 99,
                    background: filterInternational ? "rgba(255, 107, 0, 0.08)" : "var(--bg-surface)",
                    border: filterInternational ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                    transition: "all 0.2s"
                  }}>
                    <input
                      type="checkbox"
                      checked={filterInternational}
                      onChange={(e) => setFilterInternational(e.target.checked)}
                      style={{ accentColor: "var(--accent-primary)", width: 15, height: 15, cursor: "pointer" }}
                    />
                    International Students
                  </label>
                </div>
                {(filterMedical || filterNotCheckedIn || filterStrikeHistory || filterEventNoShow || filterStudentsOnly || filterMaster || filterPhd || !filterThai || !filterInternational || selectedSessionId || yearFilter.size > 0) && (
                  <p style={{ fontSize: 13, color: "var(--accent-primary)", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <Activity size={14} className="animate-pulse" />
                    Filtered: Showing {attendanceUnits.length} of {tallyUnits.length} records
                  </p>
                )}
              </div>
            )}

            {loadingAttendance ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
                  <div className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
                  <p style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 16 }}>Synchronizing records...</p>
                </div>
              </div>
            ) : attendanceError ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center", maxWidth: 420 }}>
                  <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444" }}>
                    <AlertTriangle size={36} />
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>Couldn&apos;t load the roster</h3>
                  <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>{attendanceError}</p>
                  <button className="btn btn-primary" style={{ borderRadius: 14, marginTop: 8, gap: 8 }} onClick={() => { if (activeEventId) viewAttendance(activeEventId); }}>
                    <RefreshCw size={16} /> Retry
                  </button>
                </div>
              </div>
            ) : (
              <div className="attendance-modal-list custom-scrollbar">
                {attendance.length === 0 && groupedAttendance.staff.length === 0 ? (
                  <div style={{ padding: "80px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
                    <div style={{
                      width: 100,
                      height: 100,
                      borderRadius: "50%",
                      background: "var(--bg-elevated)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-subtle)"
                    }}>
                      <Search size={40} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)" }}>Waiting for first entry</h3>
                      <p style={{ color: "var(--text-muted)", marginTop: 8, maxWidth: 400, margin: "8px auto 0" }}>
                        Scanning hasn&apos;t started yet. Once students begin checking in via QR code, they will appear here live.
                      </p>
                    </div>
                  </div>
                ) : filteredAttendance.length === 0 && groupedAttendance.staff.length === 0 ? (
                  <div style={{ padding: "80px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
                    <div style={{
                      width: 100,
                      height: 100,
                      borderRadius: "50%",
                      background: "var(--bg-elevated)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-subtle)"
                    }}>
                      {filterMedical ? <HeartPulse size={40} style={{ color: "#ef4444" }} /> : <Search size={40} />}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)" }}>
                        {filterMedical 
                          ? "No medical conditions reported" 
                          : filterNotCheckedIn 
                          ? "All registered students checked in!" 
                          : "No students match the filters"}
                      </h3>
                      <p style={{ color: "var(--text-muted)", marginTop: 8, maxWidth: 400, margin: "8px auto 0" }}>
                        {filterMedical 
                          ? `None of the ${attendance.length} checked-in students have reported any medical conditions or allergies for this event.` 
                          : filterNotCheckedIn 
                          ? "Great! Every student registered for this event has successfully checked in."
                          : "Try adjusting your filters to see more students."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
                    {groupedAttendance.staff.length > 0 && (
                      <div key="staff">
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 20,
                          padding: "12px 20px",
                          background: "rgba(99, 102, 241, 0.08)",
                          borderRadius: 16,
                          border: "1px solid rgba(99, 102, 241, 0.2)"
                        }}>
                          <div>
                            <h4 style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 12, color: "#6366f1" }}>
                              <ShieldCheck size={18} />
                              Staff
                            </h4>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginTop: 2, marginLeft: 30 }}>
                              Assigned event staff, plus anyone who checked other attendees in
                            </p>
                          </div>
                          <span className="badge" style={{ padding: "6px 16px", borderRadius: 99, background: "var(--bg-surface)", fontWeight: 800, color: "var(--text-secondary)" }}>
                            {groupedAttendance.staff.length} Members
                          </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
                          {groupedAttendance.staff.map((unit) => renderAttendanceCard(unit))}
                        </div>
                      </div>
                    )}
                    {Object.entries(groupedAttendance.houses).map(([house, members]: [string, AttendanceUnit[]]) => (
                      <div key={house}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 20,
                          padding: "12px 20px",
                          background: "var(--bg-elevated)",
                          borderRadius: 16,
                          border: "1px solid var(--border-subtle)"
                        }}>
                          <h4 style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: members[0]?.primary.user?.house?.color || "var(--accent-primary)",
                              boxShadow: `0 0 15px ${members[0]?.primary.user?.house?.color}55`
                            }} />
                            {house === "red" ? t.houseMom : house === "green" ? t.houseTo : house === "yellow" ? t.houseLuang : house === "blue" ? t.houseMakara : house}
                          </h4>
                          <span className="badge" style={{ padding: "6px 16px", borderRadius: 99, background: "var(--bg-surface)", fontWeight: 800, color: "var(--text-secondary)" }}>
                            {members.length} Members
                          </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
                          {members.map((unit) => renderAttendanceCard(unit))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Modal Footer */}
            <div style={{ padding: "20px 40px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", background: "var(--bg-elevated)" }}>
              <button className="btn btn-primary" onClick={() => setShowAttendance(false)}>Done Tracking</button>
            </div>
          </div>
        </div>
      )}

      {/* No-show Strikes Confirm Modal */}
      {showStrikesModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 2300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            className="animate-fade-in-up"
            style={{
              background: "var(--bg-elevated)",
              borderRadius: 20,
              border: "1px solid var(--border-medium)",
              width: "100%",
              maxWidth: 520,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "24px 28px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: "rgba(239,68,68,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <AlertTriangle size={22} color="#ef4444" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 18, fontWeight: 900, color: "var(--text-primary)" }}>
                  {lang === "th" ? "ยืนยันการลงโทษผู้ไม่มา" : "Confirm no-show strikes"}
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                  {lang === "th"
                    ? `บันทึกการลงโทษ 1 ครั้งต่อคน (ครบ ${NO_SHOW_STRIKE_THRESHOLD} ครั้งจะถูกระงับการลงทะเบียน)`
                    : `Records 1 strike per student (registration auto-blocks at ${NO_SHOW_STRIKE_THRESHOLD} strikes).`}
                </p>
              </div>
            </div>

            {!strikesResult && (
              <div style={{ padding: "0 28px 4px", display: "flex", alignItems: "center", gap: 10 }}>
                <label htmlFor="strikes-points-input" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                  {lang === "th" ? "หักคะแนนต่อคน" : "Points to deduct per student"}
                </label>
                <input
                  id="strikes-points-input"
                  type="number"
                  min={NO_SHOW_PENALTY_MIN}
                  max={NO_SHOW_PENALTY_MAX}
                  value={strikesPoints}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) setStrikesPoints(v);
                  }}
                  onBlur={() => setStrikesPoints((v) => Math.min(NO_SHOW_PENALTY_MAX, Math.max(NO_SHOW_PENALTY_MIN, Math.round(v) || NO_SHOW_PENALTY_POINTS)))}
                  style={{
                    width: 72, height: 34, borderRadius: 8, border: "1px solid var(--border-medium)",
                    background: "var(--bg-surface)", color: "var(--text-primary)", fontWeight: 700,
                    textAlign: "center", fontSize: 14,
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {NO_SHOW_PENALTY_MIN}–{NO_SHOW_PENALTY_MAX}
                </span>
              </div>
            )}

            <div style={{ padding: "0 28px", flex: 1, overflowY: "auto" }}>
              {strikesLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
                  {lang === "th" ? "กำลังโหลด..." : "Loading…"}
                </div>
              ) : strikesResult ? (
                <div style={{ padding: "8px 0 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#10b981", fontWeight: 800, fontSize: 15 }}>
                    <CheckCircle2 size={18} />
                    {lang === "th" ? "ดำเนินการเสร็จสิ้น" : "Strikes applied"}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {lang === "th"
                      ? `ลงโทษ ${strikesResult.struck} คน · หักคะแนนรวม ${strikesResult.pointsDeducted} · ระงับการลงทะเบียน ${strikesResult.blocked} คน`
                      : `Struck ${strikesResult.struck} student(s) · deducted ${strikesResult.pointsDeducted} total points · newly blocked ${strikesResult.blocked} student(s)`}
                  </p>
                </div>
              ) : strikesPreview.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
                  {lang === "th" ? "ไม่มีผู้ไม่มาที่ต้องลงโทษ" : "No no-shows to strike for this event."}
                </div>
              ) : (
                <div style={{ padding: "4px 0 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {lang === "th" ? `${strikesPreview.length} คนที่ลงทะเบียนแต่ไม่มาเช็คอิน` : `${strikesPreview.length} registered, never checked in`}
                  </p>
                  {strikesPreview.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 12px", borderRadius: 10, background: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{s.name}{s.nickname ? ` (${s.nickname})` : ""}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.studentId || "—"}</div>
                      </div>
                      {s.noShowCount > 0 && (
                        <span style={{
                          fontSize: 11, fontWeight: 800, color: "#ef4444", background: "rgba(239,68,68,0.12)",
                          borderRadius: 99, padding: "3px 10px", flexShrink: 0,
                        }}>
                          {s.noShowCount + 1}/{NO_SHOW_STRIKE_THRESHOLD}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: "16px 28px 24px", display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid var(--border-subtle)" }}>
              <button
                className="btn btn-ghost"
                style={{ borderRadius: 12, height: 42, paddingInline: 18, fontWeight: 700 }}
                onClick={() => { setShowStrikesModal(false); setStrikesResult(null); setStrikesPreview([]); }}
              >
                {strikesResult ? (lang === "th" ? "ปิด" : "Close") : t.cancel}
              </button>
              {!strikesResult && strikesPreview.length > 0 && (
                <button
                  className="btn btn-primary"
                  style={{ borderRadius: 12, height: 42, paddingInline: 18, fontWeight: 700, background: "linear-gradient(135deg, #ef4444, #dc2626)", border: "1px solid #dc2626" }}
                  disabled={strikesSubmitting}
                  onClick={confirmApplyStrikes}
                >
                  {strikesSubmitting
                    ? (lang === "th" ? "กำลังลงโทษ..." : "Applying…")
                    : (lang === "th" ? `ลงโทษ ${strikesPreview.length} คน` : `Strike ${strikesPreview.length} student(s)`)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Student Profile Modal */}
      {selectedStudent && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
          zIndex: 2100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }} onClick={() => setSelectedStudent(null)}>
          <div className="animate-fade-in-up" style={{
            background: "var(--bg-surface)",
            width: "100%",
            maxWidth: 500,
            borderRadius: 32,
            overflow: "hidden",
            boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
            border: "1px solid var(--border-medium)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 32, borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 20, fontWeight: 900 }}>Student Profile</h3>
              <button className="btn btn-ghost" onClick={() => setSelectedStudent(null)} style={{ borderRadius: "50%", width: 40, height: 40, padding: 0 }}><X size={18} /></button>
            </div>
            <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Header Info */}
              <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "var(--accent-primary)" }}>
                  {selectedStudent.name?.charAt(0)}
                </div>
                <div>
                  <p style={{ fontSize: 22, fontWeight: 900 }}>{selectedStudent.name}</p>
                  <p style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 600 }}>{selectedStudent.studentId} • {selectedStudent.major}</p>
                </div>
              </div>

              {/* Contact — hidden from smo (thin roster carries no phone); visible
                  to staff and a president viewing an event they own. */}
              {canSeeAttendeeContactAndMedical && (
              <div style={{ background: "var(--bg-elevated)", padding: 20, borderRadius: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.05em" }}>Contact Information</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Phone size={16} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 700 }}>{selectedStudent.phone || "No phone provided"}</span>
                </div>
              </div>
              )}

              {/* Medical & Health Info: the raw detail the student filled in is
                  PDPA-sensitive and shown only via canSeeRawMedicalDetail
                  (super_admin/admin, or a president viewing their own event —
                  contact NAME still redacted server-side for the president
                  tier, see the Emergency Contact section below). Other
                  admin-area roles (registration/organizer) still see the "has
                  a condition" signal, not the detail. */}
              {/* Medical — hidden from smo (thin roster carries no medical
                  signal, so it can't be derived here). */}
              {canSeeAttendeeContactAndMedical && (
              <div style={{
                background: hasMedicalSignal(selectedStudent)
                  ? "rgba(239, 68, 68, 0.05)"
                  : "var(--bg-elevated)",
                padding: 20,
                borderRadius: 20,
                border: hasMedicalSignal(selectedStudent)
                  ? "1px solid rgba(239, 68, 68, 0.1)"
                  : "1px solid transparent"
              }}>
                <p style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: hasMedicalSignal(selectedStudent) ? "#ef4444" : "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: 12,
                  letterSpacing: "0.05em",
                  display: "flex",
                  alignItems: "center",
                  gap: 8
                }}>
                  <HeartPulse size={14} />
                  {t.medicalHealthInfo}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {canSeeRawMedicalDetail ? (
                    <>
                      {selectedStudent.chronicDiseases && selectedStudent.chronicDiseases.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.chronicDiseases}:</b> {selectedStudent.chronicDiseases}</p>}
                      {selectedStudent.medicalHistory && selectedStudent.medicalHistory.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.medicalHistory}:</b> {selectedStudent.medicalHistory}</p>}
                      {selectedStudent.drugAllergies && selectedStudent.drugAllergies.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.drugAllergies}:</b> <span style={{ color: "#ef4444", fontWeight: 700 }}>{selectedStudent.drugAllergies}</span></p>}
                      {selectedStudent.foodAllergies && selectedStudent.foodAllergies.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.foodAllergies}:</b> <span style={{ color: "#ef4444", fontWeight: 700 }}>{selectedStudent.foodAllergies}</span></p>}
                      {selectedStudent.dietaryRestrictions && selectedStudent.dietaryRestrictions.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.dietaryRestrictions}:</b> {selectedStudent.dietaryRestrictions}</p>}
                      {selectedStudent.emergencyMedication && selectedStudent.emergencyMedication.trim() !== "-" && <p style={{ fontSize: 14 }}><b>{t.emergencyMed}:</b> <span style={{ color: "#ef4444", fontWeight: 700 }}>{selectedStudent.emergencyMedication}</span></p>}
                      {selectedStudent.faintingHistory && <p style={{ fontSize: 14, color: "#ef4444", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={14} style={{ flexShrink: 0 }} /> {t.faintingHistory}</p>}

                      {!hasActualMedicalInfo(selectedStudent) && (
                        <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>{t.noMedicalConditions}</p>
                      )}
                    </>
                  ) : hasMedicalSignal(selectedStudent) ? (
                    // Signal only — registration sees WHICH categories exist (as
                    // bullet points), never the detail the student filled in.
                    <>
                      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                        {(selectedStudent.medicalCategories ?? []).map((cat) => (
                          <li key={cat} style={{ fontSize: 14, color: "#ef4444", fontWeight: 700 }}>
                            {t[cat as keyof typeof t] ?? cat}
                          </li>
                        ))}
                      </ul>
                      <p style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
                        <AlertCircle size={14} />
                        {t.medicalDetailsRestricted}
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: 14, color: "var(--text-muted)", fontStyle: "italic" }}>{t.noMedicalConditions}</p>
                  )}
                </div>
              </div>
              )}

              {/* Emergency Contact — visible to all admin-area roles that reach
                  this modal at all (smo is excluded above, thin roster). The
                  contact's own NAME is only present when the server actually
                  sent it (super_admin/admin/registration/organizer); a
                  president viewing their own event gets relationship + phone
                  only (redacted server-side, see EmergencyContact.name above). */}
              {selectedStudent.emergencyContacts && selectedStudent.emergencyContacts.length > 0 && (
                <div style={{ background: "var(--bg-elevated)", padding: 20, borderRadius: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12, letterSpacing: "0.05em" }}>Emergency Contact</p>
                  {selectedStudent.emergencyContacts.map((c: EmergencyContact, i: number) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: 14 }}>
                          {c.name ? `${c.name} ` : ""}({c.relationship.startsWith("Other:") ? c.relationship.substring(6) : c.relationship})
                        </p>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{c.phone}</p>
                      </div>
                      <a href={`tel:${c.phone}`} className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }}><Phone size={14} /></a>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: "20px 32px", background: "var(--bg-elevated)", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => setSelectedStudent(null)}>Close Profile</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}