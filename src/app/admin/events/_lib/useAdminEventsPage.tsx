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

  const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);

  const canExportAttendance = myRoles.includes("super_admin") || myRoles.includes("admin");

  const globalRegPosition = isGlobalRegistrationPosition(myRoles, session?.user?.smoPosition, session?.user?.anusmoPosition);

  const isAttendanceOnly = !globalRegPosition && !myRoles.some((r) =>
    ["super_admin", "admin", "registration", "organizer"].includes(r)
  );

  const canSeeExportButton = canExportAttendance || myRoles.some((r) =>
    ["smo", "club_president", "major_president", "registration", "organizer"].includes(r)
  );

  const canApplyStrikes = myRoles.some((r) =>
    ["super_admin", "admin", "organizer", "registration", "club_president", "major_president"].includes(r)
  );

  const isPresidentRole = myRoles.some((r) => ["club_president", "major_president"].includes(r));

  const canEditEventDetails = !isAttendanceOnly || isPresidentRole;

  const canSeeAttendeeContactAndMedical = !isAttendanceOnly || isPresidentRole;

  const canSeeRawMedicalDetail = canExportAttendance || isPresidentRole;

  const isSmoRole = myRoles.includes("smo");

  const hasRegistrationTitle = globalRegPosition
    || session?.user?.majorPosition === "registration"
    || !!session?.user?.hasClubRegistrationPosition;

  const canManageForms = !isAttendanceOnly || isPresidentRole || hasRegistrationTitle;

  const canViewForms = canManageForms || isSmoRole;

  const canEditRestrictedFields = !isAttendanceOnly;

  const canRemoveRegistrant = globalRegPosition || myRoles.some((r) => ["super_admin", "admin", "registration"].includes(r));

  const [events, setEvents] = useState<AdminEvent[]>([]);

  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);

  const [formData, setFormData] = useState(EMPTY_FORM);

  const [clubs, setClubs] = useState<{ id: string; name: string; isArchived: boolean }[]>([]);

  const [registrationMode, setRegistrationMode] = useState<"once" | "per_session" | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);

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

  const [showAttendance, setShowAttendance] = useState(false);

  const [attendance, setAttendance] = useState<AdminAttendance[]>([]);

  const [loadingAttendance, setLoadingAttendance] = useState(false);

  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const attendanceReqRef = useRef(0);

  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  const [selectedStudent, setSelectedStudent] = useState<AdminStudent | null>(null);

  const [filterMedical, setFilterMedical] = useState(false);

  const [filterNotCheckedIn, setFilterNotCheckedIn] = useState(false);

  const [filterStrikeHistory, setFilterStrikeHistory] = useState(false);

  const [filterEventNoShow, setFilterEventNoShow] = useState(false);

  const [showStrikesModal, setShowStrikesModal] = useState(false);

  const [strikesPreview, setStrikesPreview] = useState<{ id: string; name: string; nickname: string | null; studentId: string | null; noShowCount: number }[]>([]);

  const [strikesLoading, setStrikesLoading] = useState(false);

  const [strikesSubmitting, setStrikesSubmitting] = useState(false);

  const [strikesResult, setStrikesResult] = useState<{ struck: number; blocked: number; pointsDeducted: number } | null>(null);

  const [strikesPoints, setStrikesPoints] = useState(NO_SHOW_PENALTY_POINTS);

  const [strikesSelected, setStrikesSelected] = useState<Set<string>>(new Set());

  const [filterStudentsOnly, setFilterStudentsOnly] = useState(false);

  const [filterMaster, setFilterMaster] = useState(false);

  const [filterPhd, setFilterPhd] = useState(false);

  const [filterThai, setFilterThai] = useState(true);

  const [filterInternational, setFilterInternational] = useState(true);

  const [yearFilter, setYearFilter] = useState<Set<number>>(new Set());

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [showFormBuilder, setShowFormBuilder] = useState(false);

  const [formEventId, setFormEventId] = useState<string | null>(null);

  const [formEventTitle, setFormEventTitle] = useState<string | null>(null);

  const openFormBuilder = (id: string, title: string) => {
    setFormEventId(id);
    setFormEventTitle(title);
    setShowFormBuilder(true);
  };

  const [assigneeUsers, setAssigneeUsers] = useState<{ id: string; name: string | null; studentId: string | null; role: string | null }[]>([]);

  const [staffAssigneeSearch, setStaffAssigneeSearch] = useState("");

  const ensureAssigneeUsersLoaded = () => {
    if (assigneeUsers.length > 0) return;
    fetch("/api/admin/students")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setAssigneeUsers(d.map((u) => ({ id: u.id, name: u.name, studentId: u.studentId, role: u.role }))); })
      .catch(() => {});
  };

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

  const hasMedicalSignal = (user: AdminStudent | null | undefined) =>
    !!user && (user.hasMedicalInfo === true || hasActualMedicalInfo(user));

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  usePolling(fetchEvents, 15000);

  useEffect(() => {
    fetch("/api/admin/clubs")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setClubs(d); })
      .catch(() => {});
  }, []);

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

  const splitSessionRow = (idx: number) => {
    setSessions((prev) => {
      const row = prev[idx];
      const split = splitIntoDailySessions(row.startTime, row.endTime);
      if (split.length <= 1) return prev;
      const replacement = split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime, quotaWalkIn: row.quotaWalkIn, evidenceNonce: row.evidenceNonce, evidencePrompt: row.evidencePrompt }));
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

  const activeEventSessions = [...(events.find((e) => e.id === activeEventId)?.sessions ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const isMultiDayEvent = activeEventSessions.length > 1;

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

  const sessionScoped = useMemo(() => selectedSessionId
    ? attendance.filter((m) => m.session?.id === selectedSessionId)
    : attendance, [attendance, selectedSessionId]);

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

  const { checkInCount, registeredCount, summaryPreRegistered, summaryAttendedPre, summaryWalkIns } = useMemo(() => ({
    checkInCount: tallyUnits.filter(rows => rows.some(m => m.status === "attended" && !m.isStaff)).length,
    registeredCount: tallyUnits.filter(rows => rows.some(m => !m.isStaff)).length,
    summaryPreRegistered: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered" && !m.isStaff)).length,
    summaryAttendedPre: tallyUnits.filter(rows => rows.some(m => m.method === "pre-registered" && !m.isStaff) && rows.some(m => m.status === "attended")).length,
    summaryWalkIns: tallyUnits.filter(rows => rows.every(m => m.method === "walk-in") && rows.some(m => !m.isStaff)).length,
  }), [tallyUnits]);

  const summaryNoShows = Math.max(0, summaryPreRegistered - summaryAttendedPre);

  const summaryNoShowPct = summaryPreRegistered > 0 ? Math.round((summaryNoShows / summaryPreRegistered) * 100) : 0;

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

  const eventStaffIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of attendance) {
      if (a.scannedBy) ids.add(a.scannedBy);
    }
    return ids;
  }, [attendance]);

  const activeEventStaffUserIds = useMemo(
    () => events.find((e) => e.id === activeEventId)?.staffUserIds ?? [],
    [events, activeEventId]
  );

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
    textareaRef,
    formRef,
    fetchEvents,
    openFormHandledRef,
    editHandledRef,
    set,
    updateSessionRow,
    addSessionRow,
    removeSessionRow,
    splitSessionRow,
    injectMarkup,
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
