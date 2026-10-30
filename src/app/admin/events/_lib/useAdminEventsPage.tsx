"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { Calendar, Clock, User, CheckCircle2, Activity, Info, ShieldCheck, UserX } from "lucide-react";
import { useSession } from "next-auth/react";
import { NO_SHOW_PENALTY_POINTS } from "@/lib/points/strikes";
import { eventYearFields, getAllowedEventYears, yearOfStudy } from "@/lib/access/event-access";
import { sessionSpansTooLong, splitIntoDailySessions } from "@/lib/events/event-schema";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { usePolling } from "@/lib/hooks/usePolling";
import { isGlobalRegistrationPosition } from "@/lib/access/admin-access";
import { type AdminEvent, type SessionRow, type AdminStudent, type AdminAttendance, isRegularStudent, primaryRoleLabel, MASTER_MAJORS, PHD_MAJORS, EMPTY_FORM } from "./event-model";

// One attendee on the roster: their primary row plus every per-session row.
export type AttendanceUnit = { key: string; primary: AdminAttendance; rows: AdminAttendance[] };

// State, effects and handlers for page.tsx. Moved out of the page
// component so its JSX can be split into section components that read from
// this hook's result (passed down as `ctx`).
export function useAdminEventsPage() {
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
  // columns — they must ask an admin/super_admin for that detail. registration/
  // organizer may also export: contact info yes, but no individual medical
  // signal (an aggregate-only medical summary is added to the file's Summary
  // sheet instead) — mirrors the server's isRegOrgExportRole. Mirrors the
  // server's isThinExportRole/isRegOrgExportRole exactly — deliberately
  // NARROWER than isAttendanceOnly, which also buckets in a plain club/major
  // member whose position TITLE happens to be "registration" (club_members.
  // position, see src/lib/positions.ts — cosmetic, not a system role) but who
  // holds no export-eligible role; the server already 403s that case, so the
  // button must not be shown for it either.
  const canSeeExportButton = canExportAttendance || myRoles.some((r) =>
    ["smo", "club_president", "major_president", "registration", "organizer"].includes(r)
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

  // A "registration" TITLE (src/lib/positions.ts) — distinct from the
  // "registration" ROLE already folded into isAttendanceOnly above — also gets
  // full form management, scoped to their own club/major's events server-side
  // (EventScopeService.hasRegistrationScope / gateEventForms's isPositionScoped).
  // Covers all three places that title can be held: smo/anusmo (globalRegPosition,
  // already computed above), the user's own major (majorPosition), and any club
  // they belong to (hasClubRegistrationPosition — precomputed in auth.ts, since
  // club_members rows aren't on the session). Deliberately narrow: this only
  // widens FORM management, not event-editing/medical-visibility/removal, which
  // the "registration" title was never asked to grant.
  const hasRegistrationTitle = globalRegPosition
    || session?.user?.majorPosition === "registration"
    || !!session?.user?.hasClubRegistrationPosition;

  const canManageForms = !isAttendanceOnly || isPresidentRole || hasRegistrationTitle;

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

  // Which previewed no-shows the organizer has left checked to actually
  // strike — defaults to "everyone" (matches the old strike-all behavior)
  // but lets them uncheck individual students before confirming.
  const [strikesSelected, setStrikesSelected] = useState<Set<string>>(new Set());

  const [filterStudentsOnly, setFilterStudentsOnly] = useState(false);

  const [filterMaster, setFilterMaster] = useState(false);

  const [filterPhd, setFilterPhd] = useState(false);

  const [filterThai, setFilterThai] = useState(true);

  const [filterInternational, setFilterInternational] = useState(true);

  const [yearFilter, setYearFilter] = useState<Set<number>>(new Set());

 // empty = all years
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
          allowedYears: getAllowedEventYears(proposal),
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
          setSessions(suggestedDays.map((s) => ({ title: s.title || "", startTime: toLocal(s.startTime), endTime: toLocal(s.endTime), quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null })));
        } else {
          setRegistrationMode(null);
          setSessions([{ title: "", startTime: toLocal(proposal.startTime), endTime: toLocal(proposal.endTime), quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null }]);
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
      return [...prev, { title: "", startTime, endTime, quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null }];
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
      const replacement = split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: row.quotaWalkIn, evidenceNonce: row.evidenceNonce, evidencePrompt: row.evidencePrompt }));
      return [...prev.slice(0, idx), ...replacement, ...prev.slice(idx + 1)];
    });
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
              evidenceNonce: formData.checkInMode === "evidence" ? s.evidenceNonce : null,
              evidencePrompt: formData.checkInMode === "evidence" ? s.evidencePrompt : null,
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
      shortSlug: eff("shortSlug", evt.shortSlug) || "",
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
      allowedYears: getAllowedEventYears({ ...evt, ...eventYearFields(pending) }),
      managedByRoles: evt.managedByRoles || [],
      ownerClubIds: evt.ownerClubIds || [],
      ownerMajors: evt.ownerMajors || [],
      staffUserIds: evt.staffUserIds || [],
      songsueLinked: evt.songsueLinked || false,
      // Staff-only, like the fields above — never read from a president's
      // pending payload (it can't contain it, see PRESIDENT_EDITABLE_FIELDS).
      checkInMode: evt.checkInMode || "qr",
      requireCheckOut: evt.requireCheckOut || false,
      checkOutEvidenceRequired: evt.checkOutEvidenceRequired ?? true,
      detailsReviewStatus: evt.detailsReviewStatus || "pending",
      detailsReviewedAt: evt.detailsReviewedAt || null,
    });
    // Load the people directory once for the Event Staff picker (best-effort).
    ensureAssigneeUsersLoaded();
    const pendingSessions = eff<
      { id?: string; title?: string | null; startTime: string; endTime: string; quotaWalkIn?: number | null; evidenceNonce?: string | null; evidencePrompt?: string | null }[] | undefined
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
          evidenceNonce: s.evidenceNonce ?? null,
          evidencePrompt: s.evidencePrompt ?? null,
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
            evidenceNonce: s.evidenceNonce ?? null,
            evidencePrompt: s.evidencePrompt ?? null,
          }))
      : [{ title: "", startTime: toLocal(evt.startTime), endTime: toLocal(evt.endTime), quotaWalkIn: null, evidenceNonce: null, evidencePrompt: null }];
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
  // All tallies are staff-excluded — staff don't count toward the quota (see
  // isStaff exemption in register/route.ts and scanner.service.ts), and the
  // card's Quota Progress bar (evt.attendeeCount, staff-excluded — see
  // api/admin/events/route.ts) must match what this header shows, or the
  // "checked in" figure here can end up bigger than the "registered" figure
  // shown on the card. Compute them together once per roster change instead
  // of several full passes on every render / 15s poll.
  const { checkInCount, registeredCount, summaryPreRegistered, summaryAttendedPre, summaryWalkIns } = useMemo(() => ({
    checkInCount: tallyUnits.filter(rows => rows.some(m => m.status === "attended" && !m.isStaff)).length,
    registeredCount: tallyUnits.filter(rows => rows.some(m => !m.isStaff)).length,
    summaryPreRegistered: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered" && !m.isStaff)).length,
    summaryAttendedPre: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered" && !m.isStaff) && rows.some(m => m.status === "attended")).length,
    summaryWalkIns: tallyUnits.filter(rows => rows.every(m => m.method === "walk-in") && rows.some(m => !m.isStaff)).length,
  }), [tallyUnits]);

  // Feeds the No-shows tile, which is directly tied to the "Strike No-shows"
  // action — must match who apply-strikes (isStaff-excluded, see
  // findNoShowStudentIds) will actually strike. summaryPreRegistered/
  // summaryAttendedPre above are already staff-excluded, so no separate
  // NonStaff variant is needed here.
  const summaryNoShows = Math.max(0, summaryPreRegistered - summaryAttendedPre);

  const summaryNoShowPct = summaryPreRegistered > 0 ? Math.round((summaryNoShows / summaryPreRegistered) * 100) : 0;

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
      color: "var(--emerald-500)",
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
      color: "var(--blue-500)",
    },
    {
      key: "noShow",
      label: lang === "th" ? "ไม่มา" : lang === "cn" ? "缺席" : lang === "mm" ? "မလာသူ" : "No-shows",
      value: summaryNoShows,
      sub: summaryPreRegistered > 0 ? `${summaryNoShowPct}%` : null,
      color: "var(--red-500)",
    },
  ];

  // In the "All days" view a person who attended several sessions has one
  // attendance row per day. Collapse those into a single unit (one card with a
  // per-day breakdown inside) so the roster shows people, not (person × day)
  // duplicates. When a specific day is selected there's already ≤1 row per
  // person, so each row is its own unit and the card renders exactly as before.

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
      const students = data.students || [];
      setStrikesPreview(students);
      setStrikesSelected(new Set(students.map((s: { id: string }) => s.id)));
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
    if (!activeEventId || strikesSelected.size === 0) return;
    setStrikesSubmitting(true);
    try {
      const res = await fetch(`/api/admin/events/${activeEventId}/apply-strikes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: strikesPoints, studentIds: Array.from(strikesSelected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to apply strikes");
      setStrikesResult(data);
      setStrikesPreview([]);
      setStrikesSelected(new Set());
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
    const color = option === "brought" ? "var(--emerald-500)" : option === "forgot" ? "var(--red-500)" : "var(--blue-500)";
    const bg = option === "brought" ? "rgb(var(--emerald-500-rgb) / 0.12)" : option === "forgot" ? "rgb(var(--red-500-rgb) / 0.12)" : "rgb(var(--blue-500-rgb) / 0.12)";
    const border = option === "brought" ? "rgb(var(--emerald-500-rgb) / 0.2)" : option === "forgot" ? "rgb(var(--red-500-rgb) / 0.2)" : "rgb(var(--blue-500-rgb) / 0.2)";
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
        boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.02)"
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
                  background: "rgb(var(--indigo-500-rgb) / 0.12)", color: "var(--indigo-500)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.25)",
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
              <div style={{ color: "var(--red-500)", animation: "pulse-glow 2s infinite" }} title="Medical Condition">
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
                style={{ padding: 8, borderRadius: 10, color: "var(--red-500)" }}
                title={lang === "th" ? "ลบการลงทะเบียน" : "Remove registration"}
                disabled={removingStudentId === m.user.id}
                onClick={() => removeRegistrant(m.user!.id, m.user!.name || m.user!.studentId || "this student")}
              >
                {removingStudentId === m.user.id ? <div className="spinner w-4 h-4 border-2" /> : <UserX size={18} />}
              </button>
            )}
            {multiDay ? (
              <div style={{ minWidth: 50, height: 32, padding: "0 10px", borderRadius: 16, background: attendedDays > 0 ? "rgb(var(--emerald-500-rgb) / 0.1)" : "rgb(var(--accent-rgb) / 0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, color: attendedDays > 0 ? "var(--emerald-500)" : "var(--accent-primary)", fontSize: 13, fontWeight: 800, border: attendedDays > 0 ? "none" : "1px dashed var(--accent-primary)" }} title={`${attendedDays} / ${unit.rows.length} ${lang === "th" ? "วันเช็คอินแล้ว" : "days checked in"}`}>
                <CheckCircle2 size={14} />
                {attendedDays}/{unit.rows.length}
              </div>
            ) : m.status === "attended" ? (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgb(var(--emerald-500-rgb) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--emerald-500)" }} title="Checked In">
                <CheckCircle2 size={16} />
              </div>
            ) : unregistered ? (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", border: "1px dashed var(--border-medium)" }} title="Assigned as staff — hasn't registered or checked in yet">
                <User size={14} />
              </div>
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgb(var(--accent-rgb) / 0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-primary)", border: "1px dashed var(--accent-primary)" }} title="Registered (Not Checked In)">
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
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: checked ? "var(--emerald-500)" : "var(--accent-primary)", flexShrink: 0 }}>
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

  return {
    t,
    lang,
    session,
    myRoles,
    canExportAttendance,
    globalRegPosition,
    isAttendanceOnly,
    canSeeExportButton,
    canApplyStrikes,
    isPresidentRole,
    canEditEventDetails,
    canSeeAttendeeContactAndMedical,
    canSeeRawMedicalDetail,
    isSmoRole,
    hasRegistrationTitle,
    canManageForms,
    canViewForms,
    canEditRestrictedFields,
    canRemoveRegistrant,
    events,
    setEvents,
    loading,
    setLoading,
    showForm,
    setShowForm,
    formData,
    setFormData,
    clubs,
    setClubs,
    registrationMode,
    setRegistrationMode,
    sessions,
    setSessions,
    editingId,
    setEditingId,
    sourceProposalId,
    setSourceProposalId,
    submitting,
    setSubmitting,
    deletingId,
    setDeletingId,
    removingStudentId,
    setRemovingStudentId,
    error,
    setError,
    detailsReviewToggling,
    setDetailsReviewToggling,
    songsueResyncing,
    setSongsueResyncing,
    songsueResyncMessage,
    setSongsueResyncMessage,
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus,
    showAttendance,
    setShowAttendance,
    attendance,
    setAttendance,
    loadingAttendance,
    setLoadingAttendance,
    attendanceError,
    setAttendanceError,
    attendanceReqRef,
    activeEventId,
    setActiveEventId,
    selectedStudent,
    setSelectedStudent,
    filterMedical,
    setFilterMedical,
    filterNotCheckedIn,
    setFilterNotCheckedIn,
    filterStrikeHistory,
    setFilterStrikeHistory,
    filterEventNoShow,
    setFilterEventNoShow,
    showStrikesModal,
    setShowStrikesModal,
    strikesPreview,
    setStrikesPreview,
    strikesLoading,
    setStrikesLoading,
    strikesSubmitting,
    setStrikesSubmitting,
    strikesResult,
    setStrikesResult,
    strikesPoints,
    setStrikesPoints,
    strikesSelected,
    setStrikesSelected,
    filterStudentsOnly,
    setFilterStudentsOnly,
    filterMaster,
    setFilterMaster,
    filterPhd,
    setFilterPhd,
    filterThai,
    setFilterThai,
    filterInternational,
    setFilterInternational,
    yearFilter,
    setYearFilter,
    selectedSessionId,
    setSelectedSessionId,
    showFormBuilder,
    setShowFormBuilder,
    formEventId,
    setFormEventId,
    formEventTitle,
    setFormEventTitle,
    openFormBuilder,
    assigneeUsers,
    setAssigneeUsers,
    staffAssigneeSearch,
    setStaffAssigneeSearch,
    ensureAssigneeUsersLoaded,
    confirmModal,
    setConfirmModal,
    errorModal,
    setErrorModal,
    reviewNoticeModal,
    setReviewNoticeModal,
    hasActualMedicalInfo,
    hasMedicalSignal,
    formRef,
    fetchEvents,
    openFormHandledRef,
    editHandledRef,
    set,
    updateSessionRow,
    addSessionRow,
    removeSessionRow,
    splitSessionRow,
    compressAndUploadPoster,
    posterUploading,
    setPosterUploading,
    addPosters,
    removePoster,
    movePoster,
    handleSubmit,
    handleDelete,
    removeRegistrant,
    handleEdit,
    approveEventDetails,
    discardPendingDetails,
    resyncSongsue,
    viewAttendance,
    activeEventSessions,
    isMultiDayEvent,
    eventNoShowIds,
    filteredAttendance,
    sessionScoped,
    tallyUnits,
    checkInCount,
    registeredCount,
    summaryPreRegistered,
    summaryAttendedPre,
    summaryWalkIns,
    summaryNoShows,
    summaryNoShowPct,
    activeEvent,
    showExportButton,
    showStrikeButton,
    attendanceSummaryTiles,
    attendanceUnits,
    eventStaffIds,
    activeEventStaffUserIds,
    groupedAttendance,
    exportAttendanceXlsx,
    openStrikesModal,
    confirmApplyStrikes,
    renderMedsBadge,
    renderAttendanceCard,
    getEventStatus,
    STATUS_ORDER,
    filteredEvents,
  };
}

export type AdminEventsPageCtx = ReturnType<typeof useAdminEventsPage>;
