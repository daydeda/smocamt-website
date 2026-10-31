"use client";

import { RichTextEditor } from "@/components/RichTextEditor";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { currentFirstYearPrefix } from "@/lib/access/event-access";
import { sessionSpansTooLong, splitIntoDailySessions } from "@/lib/events/event-schema";
import { parseRichText } from "@/lib/ui/rich-text";
import { POSITION_I18N_KEY } from "@/lib/access/positions";
import {
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  InlineAlert,
  LoadingState,
  Modal,
  Panel,
  StatusBadge,
  useConfirm,
  useToast,
  type Tone,
} from "@/components/admin/ui";
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Edit2,
  Eye,
  GraduationCap,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  ALL_MAJORS,
  ALL_PARTICIPANT_ROLES,
  EMPTY_FORM_BASE,
  ROLE_LABELS,
  type ProposalBase,
  type ProposalSessionRow,
} from "./shared";
import { ChipToggle, GroupLabel, IconInput, ToggleRow } from "./proposal-ui";

type Club = { id: string; name: string; isArchived: boolean };

// One entry in the Event Staff picker. Club rosters (GET
// /api/admin/clubs/[id]/members) and major rosters (GET
// /api/admin/majors/[code]/members) return different shapes; both are mapped
// to this one when loaded.
type StaffCandidate = { userId: string; name: string | null; studentId: string | null; role: string | null; position: string | null };
type ClubMemberRow = { userId: string; role: string; userName: string | null; studentId: string | null; position: string | null };
type MajorMemberRow = { id: string; name: string | null; studentId: string | null; position: string | null };

// Club proposals carry clubId/allowedClubs/club; major proposals carry majorCode.
type Proposal = ProposalBase & {
  clubId?: string;
  allowedClubs?: string[] | null;
  club?: { id: string; name: string };
  majorCode?: string | null;
};

// Which president is proposing. A club_president picks among the clubs they
// preside over; a major_president represents exactly one major (their own
// users.major), fixed for the whole component.
export type ProposeEventScope =
  | { kind: "club"; clubs: Club[] }
  | { kind: "major"; major: string };

const EMPTY_FORM = {
  ...EMPTY_FORM_BASE,
  clubId: "",
  allowedClubs: [] as string[],
};

const STATUS_TONE: Record<Proposal["status"], Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

// Stable per-club accent color, cycling through a fixed qualitative palette
// by the club's position in `activeClubs` — lets a president who presides
// over several clubs visually tell proposals apart at a glance (group header
// dot + matching card border) without relying on reading the club name text.
const CLUB_ACCENT_COLORS = ["var(--indigo-500)", "var(--green-500)", "var(--amber-500)", "var(--pink-500)", "var(--cyan-500)", "var(--violet-500)", "var(--red-500)", "var(--teal-500)"];

// club_president / major_president section (on /admin/clubs and
// /admin/majors): submit a request for an event. All requested fields (title/time/audience/poster/staff/etc.) are
// non-binding suggestions — staff still decides pointsAwarded/allowedRoles/
// allowedMajors/managedByRoles/ownerClubIds explicitly when creating the real
// event from an approved proposal (see POST /api/admin/events' proposalId
// linkage). Own-scope end to end (described here for clubs; majors use
// GET /api/admin/majors/[code]/members and users.major instead): the clubs prop is already the clubs
// THIS president presides over (from the page's own scoped GET
// /api/admin/clubs), the proposals list/withdraw APIs independently
// re-verify ownership server-side, and the suggested Event Staff picker below
// only ever reads the SAME club's own member roster (GET
// /api/admin/clubs/[id]/members) — never the global student directory.
export function ProposeEventSection({ scope }: { scope: ProposeEventScope }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const isClub = scope.kind === "club";
  // The major_president's own major; null in club mode.
  const ownMajor = scope.kind === "major" ? scope.major : null;
  const activeClubs = scope.kind === "club" ? scope.clubs.filter((c) => !c.isArchived) : [];
  const clubColor = (clubId: string) => {
    const idx = activeClubs.findIndex((c) => c.id === clubId);
    return CLUB_ACCENT_COLORS[(idx < 0 ? 0 : idx) % CLUB_ACCENT_COLORS.length];
  };

  const STATUS_LABEL: Record<Proposal["status"], string> = {
    pending: t.adminCmStatusPending,
    approved: t.adminProposalsFilterApproved,
    rejected: t.adminProposalsFilterRejected,
    withdrawn: t.adminProposalsFilterWithdrawn,
  };
  const statusBadge = (status: Proposal["status"]) => <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>;

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  // Set while editing a REJECTED proposal for resubmission (PATCH
  // action=resubmit) instead of creating a brand new one (POST). null = the
  // form is either closed or in plain "new proposal" mode.
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  // Details view — lets a club_president re-check exactly what they submitted
  // (full per-day schedule, audience, quotas, etc.) against a proposal card's
  // summary badges, e.g. to confirm whether a "3 days" badge really reflects
  // 3 intended days or an extra day added by mistake.
  const [viewingProposal, setViewingProposal] = useState<Proposal | null>(null);
  // "Suggested access" is rarely needed, so it starts collapsed (opens by itself
  // when a resubmitted proposal already has some).
  const [showAccess, setShowAccess] = useState(false);

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, val: typeof EMPTY_FORM[K]) => setForm((f) => ({ ...f, [key]: val }));

  const load = () => {
    // ?type=club / ?type=major: each page only renders its own kind of
    // proposal — a president who holds both club_president and
    // major_president would otherwise get the other kind mixed in, since the
    // unfiltered endpoint returns everything the viewer can see.
    setLoadError(false);
    fetch(`/api/admin/event-proposals?type=${scope.kind}`)
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setProposals(d); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  const reload = () => {
    setLoading(true);
    load();
  };

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForm = () => {
    setEditingProposalId(null);
    setForm({ ...EMPTY_FORM, clubId: activeClubs[0]?.id ?? "" });
    setFormError(null);
    setSubmitAttempted(false);
    setShowAccess(false);
    setStaffSearch("");
    setRegistrationMode(null);
    // Seed one empty row so a single-day proposal still mirrors it (see the
    // main Start/End onChange handlers below) — mirrors admin/events/page.tsx.
    setSessions([{ title: "", startTime: "", endTime: "" }]);
    setShowForm(true);
  };

  // Converts a datetime ISO string (as stored/returned by the API) into the
  // `datetime-local` input value format (local time, no offset/seconds).
  const toDatetimeLocal = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  };

  // Opens the same form pre-filled with a REJECTED proposal's own content, so
  // the president can fix whatever staff flagged and resubmit it (PATCH
  // action=resubmit) rather than starting over from a blank proposal.
  const openEditResubmit = (p: Proposal) => {
    setEditingProposalId(p.id);
    setForm({
      clubId: p.clubId ?? "",
      title: p.title,
      description: p.description ?? "",
      startTime: toDatetimeLocal(p.startTime),
      endTime: toDatetimeLocal(p.endTime),
      registrationOpenTime: toDatetimeLocal(p.registrationOpenTime),
      registrationCloseTime: toDatetimeLocal(p.registrationCloseTime),
      location: p.location ?? "",
      quota: p.quota != null ? String(p.quota) : "",
      imageUrls: p.imageUrls ?? (p.imageUrl ? [p.imageUrl] : []),
      walkInsEnabled: p.walkInsEnabled ?? false,
      walkInsOnly: p.walkInsOnly ?? false,
      quotaWalkIn: p.quotaWalkIn != null ? String(p.quotaWalkIn) : "",
      targetThai: p.targetThai ?? true,
      targetInternational: p.targetInternational ?? true,
      quotaThai: p.quotaThai != null ? String(p.quotaThai) : "",
      quotaInternational: p.quotaInternational != null ? String(p.quotaInternational) : "",
      firstYearOnly: p.firstYearOnly ?? false,
      staffUserIds: p.staffUserIds ?? [],
      allowedRoles: p.allowedRoles ?? [],
      allowedMajors: p.allowedMajors ?? [],
      allowedClubs: p.allowedClubs ?? [],
    });
    setFormError(null);
    setSubmitAttempted(false);
    setShowAccess(!!((p.allowedRoles && p.allowedRoles.length) || (p.allowedMajors && p.allowedMajors.length) || (p.allowedClubs && p.allowedClubs.length)));
    setStaffSearch("");
    if (p.sessions && p.sessions.length > 1) {
      setRegistrationMode("once");
      setSessions(p.sessions.map((s) => ({ title: s.title ?? "", startTime: toDatetimeLocal(s.startTime), endTime: toDatetimeLocal(s.endTime) })));
    } else {
      setRegistrationMode(null);
      setSessions([{ title: "", startTime: toDatetimeLocal(p.startTime), endTime: toDatetimeLocal(p.endTime) }]);
    }
    setViewingProposal(null);
    setShowForm(true);
  };

  // ---- Suggested multi-day schedule (optional). registrationMode === null =
  // single-day event, covered entirely by the Start/End time above — mirrors
  // the staff create-event form exactly (admin/events/page.tsx's
  // registrationMode + Days editor): `sessions` always holds ≥1 row while the
  // form is open (mirroring the main Start/End in single-day mode), and holds
  // EVERY day — not just the days beyond day 1 — once "Once" is picked. Minus
  // per-day walk-in quotas, which stay a staff-only decision at conversion
  // time. ----
  const [registrationMode, setRegistrationMode] = useState<"once" | null>(null);
  const [sessions, setSessions] = useState<ProposalSessionRow[]>([]);

  // The form scrolls inside the modal body, not the full page — so revealing
  // the Days section or adding a row can push the newly-added content (and the
  // "+Add day" button itself) below the visible fold with no automatic scroll.
  // Without this it reads as "I clicked and nothing happened."
  const daysSectionRef = useRef<HTMLDivElement>(null);
  const addDayButtonRef = useRef<HTMLButtonElement>(null);
  const prevSessionsLength = useRef(0);
  const formRef = useRef<HTMLDivElement>(null);
  const posterFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (registrationMode === "once") {
      daysSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [registrationMode]);

  useEffect(() => {
    if (sessions.length > prevSessionsLength.current) {
      addDayButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevSessionsLength.current = sessions.length;
  }, [sessions.length]);

  // Bring a form-level error into view (the body scrolls, the footer does not).
  useEffect(() => {
    if (formError) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [formError]);

  const addSessionRow = () => {
    setSessions((prev) => {
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
      return [...prev, { title: "", startTime, endTime }];
    });
  };
  const updateSessionRow = (idx: number, patch: Partial<ProposalSessionRow>) => {
    setSessions((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeSessionRow = (idx: number) => {
    // Never leave the proposal with zero days — mirrors admin/events/page.tsx.
    setSessions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };
  // Fixes a single extra-day row that spans multiple calendar days (see
  // sessionSpansTooLong) by replacing it in place with one row per day.
  const splitSessionRow = (idx: number) => {
    setSessions((prev) => {
      const row = prev[idx];
      const split = splitIntoDailySessions(row.startTime, row.endTime);
      if (split.length <= 1) return prev;
      const replacement = split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime }));
      return [...prev.slice(0, idx), ...replacement, ...prev.slice(idx + 1)];
    });
  };

  // ---- Event Staff picker: THIS club's own roster, or students in THIS
  // president's own major (never the global student directory — see the
  // component-level comment above). Reloads whenever the selected club
  // changes. ----
  const [staffCandidates, setStaffCandidates] = useState<StaffCandidate[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");

  useEffect(() => {
    if (!showForm) return;
    if (isClub && !form.clubId) return;
    const timer = setTimeout(() => {
      setLoadingMembers(true);
      const url = isClub ? `/api/admin/clubs/${form.clubId}/members` : `/api/admin/majors/${ownMajor}/members`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => {
          if (!Array.isArray(d)) return;
          setStaffCandidates(isClub
            ? (d as ClubMemberRow[]).map((m) => ({ userId: m.userId, name: m.userName, studentId: m.studentId, role: m.role, position: m.position }))
            : (d as MajorMemberRow[]).map((m) => ({ userId: m.id, name: m.name, studentId: m.studentId, role: null, position: m.position })));
        })
        .catch(() => {})
        .finally(() => setLoadingMembers(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [showForm, form.clubId, isClub, ownMajor]);

  // ---- Poster upload — mirrors the staff create-event multi-poster pipeline
  // (client-side compress to WebP, then POST /api/upload; server re-checks
  // the 5MB cap / magic bytes regardless). ----
  const [posterUploading, setPosterUploading] = useState(0);

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
              if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }
            } else {
              if (height > MAX_HEIGHT) { width = Math.round((width * MAX_HEIGHT) / height); height = MAX_HEIGHT; }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))), "image/webp", 0.8);
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

  const addPosters = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setPosterUploading((n) => n + list.length);
    try {
      for (const file of list) {
        try {
          const url = await compressAndUploadPoster(file);
          if (url) {
            setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
          } else {
            toast.error(t.adminCmPosterFailed, file.name);
          }
        } catch (err) {
          console.error("Poster compression / upload failed:", err);
          toast.error(t.adminCmPosterFailed, file.name);
        } finally {
          setPosterUploading((n) => Math.max(0, n - 1));
        }
      }
    } catch {
      setPosterUploading(0);
    }
  };

  const removePoster = (idx: number) => {
    setForm((prev) => ({ ...prev, imageUrls: prev.imageUrls.filter((_, i) => i !== idx) }));
  };

  const movePoster = (idx: number, dir: -1 | 1) => {
    setForm((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.imageUrls.length) return prev;
      const next = [...prev.imageUrls];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, imageUrls: next };
    });
  };

  // Inline validation. Required-field errors wait until the first submit
  // attempt (nobody likes red on an untouched form); an end before the start
  // shows as soon as both are filled.
  const endBeforeStart = !!form.startTime && !!form.endTime && new Date(form.endTime).getTime() < new Date(form.startTime).getTime();
  const errors = {
    club: isClub && !form.clubId ? t.adminCmErrClub : null,
    title: !form.title.trim() ? t.adminCmErrTitle : null,
    startTime: !form.startTime ? t.adminCmErrStart : null,
    endTime: !form.endTime ? t.adminCmErrEnd : endBeforeStart ? t.adminCmErrEndBeforeStart : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const shown = (msg: string | null) => (submitAttempted || msg === t.adminCmErrEndBeforeStart ? msg : null);

  const submit = async () => {
    if (hasErrors) {
      setSubmitAttempted(true);
      setFormError(t.adminCmFixErrors);
      // Move focus to the first field that needs attention once errors render.
      window.setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    // Only block when the president has opted into a per-day schedule
    // (registrationMode "once") and one of THOSE rows itself spans multiple
    // days — a genuine mistake, since each row is meant to be a single day.
    // A plain multi-day start/end with no split chosen is a deliberate
    // "one check-in for the whole range" event (e.g. a 3-day camp) and must
    // NOT be force-split — the banner below still offers Split as an option,
    // it just no longer blocks submission. Mirrors admin/events/page.tsx.
    if (registrationMode === "once" && sessions.some((s) => sessionSpansTooLong(s.startTime, s.endTime))) {
      setFormError(t.multiDaySessionWarning);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const isResubmit = editingProposalId !== null;
    try {
      const res = await fetch(
        isResubmit ? `/api/admin/event-proposals/${editingProposalId}` : "/api/admin/event-proposals",
        {
          method: isResubmit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(isResubmit ? { action: "resubmit" } : isClub ? { clubId: form.clubId } : { majorCode: ownMajor }),
            title: form.title.trim(),
            description: form.description.trim() || undefined,
            startTime: new Date(form.startTime).toISOString(),
            endTime: new Date(form.endTime).toISOString(),
            registrationOpenTime: form.registrationOpenTime ? new Date(form.registrationOpenTime).toISOString() : undefined,
            registrationCloseTime: form.registrationCloseTime ? new Date(form.registrationCloseTime).toISOString() : undefined,
            location: form.location.trim() || undefined,
            quota: form.quota ? Number(form.quota) : undefined,
            imageUrl: form.imageUrls[0] || undefined,
            imageUrls: form.imageUrls.length > 0 ? form.imageUrls : undefined,
            walkInsEnabled: form.walkInsOnly ? true : form.walkInsEnabled,
            walkInsOnly: form.walkInsOnly,
            quotaWalkIn: form.walkInsEnabled && !form.walkInsOnly && form.quotaWalkIn ? Number(form.quotaWalkIn) : undefined,
            targetThai: form.targetThai,
            targetInternational: form.targetInternational,
            quotaThai: form.targetThai && form.quotaThai ? Number(form.quotaThai) : undefined,
            quotaInternational: form.targetInternational && form.quotaInternational ? Number(form.quotaInternational) : undefined,
            firstYearOnly: form.firstYearOnly,
            staffUserIds: form.staffUserIds.length > 0 ? form.staffUserIds : undefined,
            allowedRoles: form.allowedRoles.length > 0 ? form.allowedRoles : undefined,
            allowedMajors: form.allowedMajors.length > 0 ? form.allowedMajors : undefined,
            allowedClubs: isClub && form.allowedClubs.length > 0 ? form.allowedClubs : undefined,
            // Only sent when genuinely multi-day (2+ rows) — sessions now holds
            // EVERY day including day 1 (mirrors admin/events/page.tsx), so a
            // plain single-day proposal sends no sessions at all.
            sessions: registrationMode === "once" && sessions.length > 1
              ? sessions
                  .filter((s) => s.startTime && s.endTime)
                  .map((s) => ({
                    title: s.title.trim() || undefined,
                    startTime: new Date(s.startTime).toISOString(),
                    endTime: new Date(s.endTime).toISOString(),
                  }))
              : undefined,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.error) || (isResubmit ? t.adminProposalsResubmitError : t.adminProposalsSubmitError));
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setRegistrationMode(null);
      setSessions([]);
      setEditingProposalId(null);
      setSubmitAttempted(false);
      load();
      toast.success(isResubmit ? t.adminCmResubmitted : t.adminProposalsSubmitSuccess);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : (editingProposalId ? t.adminProposalsResubmitError : t.adminProposalsSubmitError));
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (p: Proposal) => {
    const ok = await confirm({
      title: t.adminCmWithdrawTitle.replace("{title}", p.title),
      message: t.adminCmWithdrawBody,
      confirmLabel: t.adminCmWithdrawConfirm,
      tone: "danger",
    });
    if (!ok) return;
    setWithdrawingId(p.id);
    try {
      const res = await fetch(`/api/admin/event-proposals/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      if (res.ok) {
        load();
        setViewingProposal(null);
        toast.success(t.adminCmWithdrawn.replace("{title}", p.title));
      } else {
        const data = await res.json().catch(() => null);
        toast.error(t.adminCmWithdrawFailed, (data && data.error) || undefined);
      }
    } catch {
      toast.error(t.adminCmWithdrawFailed);
    } finally {
      setWithdrawingId(null);
    }
  };

  const closeForm = () => {
    if (!submitting) setShowForm(false);
  };

  const dayWord = (n: number) => t.adminCmDaysCount.replace("{n}", String(n));
  const staffWord = (n: number) => t.adminCmStaffCount.replace("{n}", String(n));
  const scopeName = (p: Proposal) => p.club?.name ?? p.majorCode ?? "";

  const subtleBadge = (key: string, text: string) => (
    <StatusBadge key={key} tone="neutral" icon={false}>{text}</StatusBadge>
  );

  const renderCard = (p: Proposal, accent?: string) => {
    const poster = p.imageUrls?.[0] || p.imageUrl;
    const hasBadges = p.walkInsEnabled || p.firstYearOnly || (p.staffUserIds && p.staffUserIds.length > 0) || (p.sessions && p.sessions.length > 1);
    return (
      <li
        key={p.id}
        style={{
          listStyle: "none",
          background: "var(--bg-elevated)",
          borderRadius: 16,
          padding: "12px 16px",
          borderLeft: accent ? `3px solid ${accent}` : undefined,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setViewingProposal(p)}
          aria-label={t.adminCmViewProposal.replace("{title}", p.title)}
          style={{ display: "flex", gap: 12, width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
        >
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
          )}
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{p.title}</span>
              {statusBadge(p.status)}
            </span>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {p.club ? `${p.club.name} · ` : ""}{new Date(p.startTime).toLocaleString()}
            </span>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t.adminProposalsRequestedByLabel} {p.proposer.name}{p.proposer.studentId ? ` (${p.proposer.studentId})` : ""}
            </span>
            {hasBadges && (
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {p.sessions && p.sessions.length > 1 && subtleBadge("days", dayWord(p.sessions.length))}
                {p.walkInsOnly ? subtleBadge("walk", t.walkInsOnlyBadge) : p.walkInsEnabled && subtleBadge("walk", t.allowWalkins)}
                {p.firstYearOnly && subtleBadge("fy", t.firstYearOnly)}
                {p.staffUserIds && p.staffUserIds.length > 0 && subtleBadge("staff", staffWord(p.staffUserIds.length))}
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--accent-primary)", marginTop: 2 }}>
              <Eye size={14} aria-hidden="true" /> {t.adminCmViewDetails}
            </span>
          </span>
        </button>

        {p.reviewNote && p.status === "rejected" ? (
          <InlineAlert tone="error" title={t.adminProposalsRejectReasonLabel}>{p.reviewNote}</InlineAlert>
        ) : p.reviewNote ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{p.reviewNote}</p>
        ) : null}

        {(p.status === "pending" || p.status === "rejected") && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {p.status === "rejected" && (
              <button className="btn btn-ghost btn-sm" style={{ color: "var(--accent-primary)" }} onClick={() => openEditResubmit(p)}>
                <Edit2 size={13} aria-hidden="true" />
                {t.adminProposalsResubmitButton}
              </button>
            )}
            {p.status === "pending" && (
              // Destructive: kept on its own, away from the card's main click target.
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--red-600)", marginLeft: "auto" }}
                disabled={withdrawingId === p.id}
                onClick={() => withdraw(p)}
                aria-label={`${t.adminProposalsWithdrawButton}: ${p.title}`}
              >
                {withdrawingId === p.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                {t.adminProposalsWithdrawButton}
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  const renderList = () => {
    // Multiple clubs presided over: group proposals under a per-club
    // header (name + count + accent dot) so it's immediately obvious
    // which club each proposal belongs to, instead of relying on reading
    // the small club-name subtitle on every card. A single-club
    // president skips this — there's nothing to disambiguate.
    if (activeClubs.length > 1) {
      const groups = activeClubs
        .map((c) => ({ club: c, items: proposals.filter((p) => p.clubId === c.id) }))
        .filter((g) => g.items.length > 0);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {groups.map(({ club, items }) => {
            const color = clubColor(club.id);
            return (
              <section key={club.id} aria-label={club.name}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{club.name}</h3>
                  <StatusBadge tone="neutral" icon={false}>{items.length}</StatusBadge>
                </div>
                <ul style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0 }}>
                  {items.map((p) => renderCard(p, color))}
                </ul>
              </section>
            );
          })}
        </div>
      );
    }
    return (
      <ul style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0 }}>
        {proposals.map((p) => renderCard(p))}
      </ul>
    );
  };

  const canPropose = !isClub || activeClubs.length > 0;
  const proposeButton = canPropose ? (
    <button className="btn btn-primary btn-sm" onClick={openForm}>
      <Plus size={14} aria-hidden="true" />
      {t.adminProposalsSectionTitle}
    </button>
  ) : undefined;

  const staffLabel = (uid: string) => {
    const u = staffCandidates.find((x) => x.userId === uid);
    return u ? (u.name || u.studentId || uid) : uid;
  };

  const posterBusy = posterUploading > 0;
  const staffQuery = staffSearch.trim().toLowerCase();
  const staffMatches = staffQuery
    ? staffCandidates
        .filter((u) => (u.name || "").toLowerCase().includes(staffQuery) || (u.studentId || "").toLowerCase().includes(staffQuery))
        .slice(0, 30)
    : [];

  return (
    <div style={{ marginBottom: 24 }}>
      <Panel
        title={isClub ? t.adminProposalsClubTitle : t.adminProposalsMajorTitle}
        icon={<CalendarPlus size={20} />}
        description={t.adminCmProposalsDesc}
        actions={proposeButton}
      >
        {loading ? (
          <LoadingState compact label={t.adminCmLoadingProposals} />
        ) : loadError ? (
          <ErrorState compact title={t.adminCmLoadProposalsFailed} onRetry={reload} />
        ) : proposals.length === 0 ? (
          <EmptyState
            compact
            icon={<CalendarPlus size={24} />}
            title={t.adminProposalsEmptyMessage}
            description={canPropose ? t.adminCmProposalsEmptyBody : t.adminCmProposalsNoClubBody}
            action={canPropose ? (
              <button className="btn btn-primary" onClick={openForm}>
                <Plus size={16} aria-hidden="true" />
                {t.adminProposalsSectionTitle}
              </button>
            ) : undefined}
          />
        ) : (
          renderList()
        )}
      </Panel>

      {/* Propose / resubmit form. A kit Modal: portaled to <body> (so the page
          wrapper's residual transform can't re-anchor it), Escape, focus trap,
          sticky footer, bottom sheet on phones. Locked while a request is in flight. */}
      <Modal
        open={showForm}
        onClose={closeForm}
        size="lg"
        dismissible={!submitting}
        icon={<CalendarPlus size={20} />}
        title={editingProposalId ? t.adminProposalsResubmitTitle : t.adminProposalsSectionTitle}
        description={editingProposalId ? t.adminCmResubmitDesc : t.adminCmFormDesc}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeForm} disabled={submitting}>
              {t.adminProposalsCancelButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || posterBusy}>
              {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
              {submitting
                ? t.adminCmSubmitting
                : editingProposalId ? t.adminProposalsResubmitButton : t.adminProposalsSubmitButton}
            </button>
          </>
        }
      >
        <div ref={formRef} style={{ display: "flex", flexDirection: "column", gap: 16, scrollMarginTop: 8 }}>
          {formError && (
            <InlineAlert tone="error">{formError}</InlineAlert>
          )}
          <p className="adm-field-hint">{t.adminCmRequiredLegend}</p>

          {/* 1. Basics */}
          <Panel title={t.adminCmGroupBasics} description={t.adminCmGroupBasicsDesc}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {isClub && activeClubs.length > 1 && !editingProposalId && (
                <Field label={t.adminProposalsClubLabel} required error={shown(errors.club)}>
                  {(p) => (
                    <select
                      {...p}
                      className="input"
                      value={form.clubId}
                      onChange={(e) => setForm({ ...form, clubId: e.target.value, staffUserIds: [] })}
                    >
                      {!form.clubId && <option value="">{t.adminCmChooseClub}</option>}
                      {activeClubs.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {isClub && (activeClubs.length === 1 || editingProposalId) && (
                // Club is fixed (single club, or once a proposal exists —
                // resubmitting only edits its content, not which club it belongs to).
                <div>
                  <p className="adm-field-label">{t.adminProposalsClubLabel}</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                    {activeClubs.find((c) => c.id === form.clubId)?.name ?? form.clubId}
                  </p>
                </div>
              )}
              {ownMajor && (
                <div>
                  <p className="adm-field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <GraduationCap size={16} aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
                    {t.adminCmMajorLabel}
                  </p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{ownMajor}</p>
                </div>
              )}
              <Field label={t.adminProposalsTitleLabel} required hint={t.adminCmTitleHint} error={shown(errors.title)}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    maxLength={200}
                    style={{ fontSize: 16 }}
                  />
                )}
              </Field>

              {/* Description: the same shared editor as the staff create-event form,
                  so proposal text uses identical markup and renders identically
                  once approved. */}
              <div className="field">
                <RichTextEditor
                  layout="split"
                  lang={lang}
                  minHeight={240}
                  maxLength={2000}
                  label={<span className="adm-field-label">{t.adminProposalsDescriptionLabel}</span>}
                  value={form.description}
                  onChange={(v) => set("description", v)}
                  placeholder={t.adminCmDescriptionPlaceholder}
                />
              </div>
            </div>
          </Panel>

          {/* 2. Date and time */}
          <Panel title={t.adminCmGroupWhen} description={t.adminCmGroupWhenDesc}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t.adminProposalsStartLabel} required error={shown(errors.startTime)}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={form.startTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((f) => ({ ...f, startTime: val }));
                        // Single-day mode: keep the sole session row mirrored to
                        // the main start/end — mirrors admin/events/page.tsx.
                        if (registrationMode === null && sessions.length === 1) {
                          setSessions([{ ...sessions[0], startTime: val }]);
                        }
                      }}
                    />
                  )}
                </Field>
                <Field label={t.adminProposalsEndLabel} required error={shown(errors.endTime)}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="datetime-local"
                      lang="en-GB"
                      value={form.endTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((f) => ({ ...f, endTime: val }));
                        if (registrationMode === null && sessions.length === 1) {
                          setSessions([{ ...sessions[0], endTime: val }]);
                        }
                      }}
                    />
                  )}
                </Field>
              </div>

              {registrationMode === null && sessionSpansTooLong(form.startTime, form.endTime) && (
                <InlineAlert tone="warning">
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span>{t.multiDaySessionWarning}</span>
                    <button
                      type="button"
                      onClick={() => {
                        // Splits into ALL days (not "day 1 + extras") and leaves
                        // form.startTime/endTime untouched as the overall display
                        // range — mirrors admin/events/page.tsx's split behavior
                        // exactly, so the End Time here no longer collapses.
                        const split = splitIntoDailySessions(form.startTime, form.endTime);
                        if (split.length > 1) {
                          setRegistrationMode("once");
                          setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime })));
                        }
                      }}
                      className="btn btn-ghost btn-sm"
                      style={{ alignSelf: "flex-start" }}
                    >
                      {t.splitIntoDays}
                    </button>
                  </div>
                </InlineAlert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t.eventRegistrationOpenLabel} hint={t.adminCmRegistrationHint}>
                  {(p) => <input {...p} className="input" type="datetime-local" lang="en-GB" value={form.registrationOpenTime} onChange={(e) => set("registrationOpenTime", e.target.value)} />}
                </Field>
                <Field label={t.eventRegistrationCloseLabel}>
                  {(p) => <input {...p} className="input" type="datetime-local" lang="en-GB" value={form.registrationCloseTime} onChange={(e) => set("registrationCloseTime", e.target.value)} />}
                </Field>
              </div>

              {/* How students register — tick "Once" to opt into a multi-day
                  schedule (nothing selected by default, exactly like the staff
                  create-event form's registrationMode picker in
                  admin/events/page.tsx). 'per_session' is intentionally not
                  offered: the student registration flow has no per-day path yet. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <GroupLabel id="reg-mode-label" hint={t.registrationModeHint}>{t.registrationModeLabel}</GroupLabel>
                <ToggleRow
                  checked={registrationMode === "once"}
                  label={t.registrationModeOnce}
                  hint={t.registrationModeOnceDesc}
                  onChange={() => {
                    if (registrationMode === "once") {
                      // Click again to un-select — collapse back to a single
                      // session row mirroring the main start/end, same as
                      // admin/events/page.tsx.
                      const first = sessions[0];
                      setRegistrationMode(null);
                      setSessions([{ title: first?.title ?? "", startTime: form.startTime, endTime: form.endTime }]);
                    } else {
                      setRegistrationMode("once");
                      // The sole row still mirrors the main start/end. If that
                      // range itself spans multiple calendar days, split it into
                      // one row per day right away — sessions now holds EVERY
                      // day (mirrors admin/events/page.tsx), not just extras.
                      const first = sessions[0];
                      if (first?.startTime && first?.endTime) {
                        const split = splitIntoDailySessions(first.startTime, first.endTime);
                        if (split.length > 1) {
                          setSessions(split.map((d) => ({ title: "", startTime: d.startTime, endTime: d.endTime })));
                        }
                      }
                    }
                  }}
                />
              </div>

              {/* Days / Sessions — only shown once "Once" is selected above
                  (multi-day event). At least one row is required once shown;
                  staff finalizes the real per-day sessions (and any walk-in
                  sub-quotas) when creating the event from this proposal. */}
              {registrationMode !== null && (
                <div ref={daysSectionRef} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <h4 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                    <Clock size={16} aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
                    {t.sessionsHeading}
                    <span style={{ fontWeight: 500, color: "var(--text-muted)", fontSize: 13 }}>· {dayWord(sessions.length)}</span>
                  </h4>
                  <InlineAlert tone="info">{t.sessionsNoteOnce}</InlineAlert>
                  {sessions.map((s, idx) => (
                    <div
                      key={idx}
                      style={{ background: "var(--bg-elevated)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <p style={{ fontWeight: 700, fontSize: 14 }}>{t.adminCmDayN.replace("{n}", String(idx + 1))}</p>
                        <IconButton
                          tone="danger"
                          size="sm"
                          label={`${t.removeDay}: ${t.adminCmDayN.replace("{n}", String(idx + 1))}`}
                          icon={<Trash2 size={16} />}
                          disabled={sessions.length <= 1}
                          onClick={() => removeSessionRow(idx)}
                        />
                      </div>
                      <Field label={t.sessionTitleLabel}>
                        {(p) => (
                          <input
                            {...p}
                            className="input"
                            value={s.title}
                            onChange={(e) => updateSessionRow(idx, { title: e.target.value })}
                            placeholder={t.adminCmDayN.replace("{n}", String(idx + 1))}
                          />
                        )}
                      </Field>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label={t.adminProposalsStartLabel}>
                          {(p) => <input {...p} className="input" type="datetime-local" lang="en-GB" value={s.startTime} onChange={(e) => updateSessionRow(idx, { startTime: e.target.value })} />}
                        </Field>
                        <Field label={t.adminProposalsEndLabel}>
                          {(p) => <input {...p} className="input" type="datetime-local" lang="en-GB" value={s.endTime} onChange={(e) => updateSessionRow(idx, { endTime: e.target.value })} />}
                        </Field>
                      </div>
                      {sessionSpansTooLong(s.startTime, s.endTime) && (
                        <InlineAlert tone="warning">
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <span>{t.multiDaySessionWarning}</span>
                            <button type="button" onClick={() => splitSessionRow(idx)} className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
                              {t.splitIntoDays}
                            </button>
                          </div>
                        </InlineAlert>
                      )}
                    </div>
                  ))}
                  <button type="button" ref={addDayButtonRef} onClick={addSessionRow} className="btn btn-ghost" style={{ alignSelf: "flex-start" }}>
                    <Plus size={16} aria-hidden="true" /> {t.addDay}
                  </button>
                </div>
              )}
            </div>
          </Panel>

          {/* 3. Place and seats */}
          <Panel title={t.adminCmGroupPlace} description={t.adminCmGroupPlaceDesc}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t.adminProposalsLocationLabel}>
                  {(p) => (
                    <IconInput icon={<MapPin size={18} />}>
                      <input {...p} className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={200} placeholder="CAMT Auditorium" style={{ paddingLeft: 44 }} />
                    </IconInput>
                  )}
                </Field>
                <Field label={t.adminProposalsQuotaLabel}>
                  {(p) => (
                    <IconInput icon={<Users size={18} />}>
                      <input {...p} className="input" type="number" inputMode="numeric" min={0} value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} placeholder={t.unlimitedIfZero} style={{ paddingLeft: 44 }} />
                    </IconInput>
                  )}
                </Field>
              </div>

              <ToggleRow
                checked={form.walkInsEnabled}
                label={t.allowWalkins}
                onChange={() => {
                  if (form.walkInsOnly) return; // locked on while Walk-ins Only is set
                  const nextVal = !form.walkInsEnabled;
                  setForm({ ...form, walkInsEnabled: nextVal, ...(!nextVal && { quotaWalkIn: "" }) });
                }}
              />

              {/* Walk-ins Only — no pre-registration accepted at all. Implies
                  Allow Walk-ins. */}
              <ToggleRow
                checked={form.walkInsOnly}
                label={t.walkInsOnlyToggleLabel}
                hint={t.walkInsOnlyToggleHint}
                onChange={() => {
                  const nextVal = !form.walkInsOnly;
                  setForm({ ...form, walkInsOnly: nextVal, ...(nextVal && { walkInsEnabled: true }) });
                }}
              />

              {form.walkInsEnabled && !form.walkInsOnly && (
                <Field label={t.walkInQuota} hint={t.walkInQuotaHint}>
                  {(p) => (
                    <IconInput icon={<Users size={18} />}>
                      <input {...p} className="input" type="number" inputMode="numeric" min={0} value={form.quotaWalkIn} onChange={(e) => set("quotaWalkIn", e.target.value)} placeholder={t.unlimitedIfEmpty} style={{ paddingLeft: 44 }} />
                    </IconInput>
                  )}
                </Field>
              )}
            </div>
          </Panel>

          {/* 4. Who can join */}
          <Panel title={t.adminCmGroupWho} description={t.adminCmGroupWhoDesc}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Target Audience Eligibility */}
              <div role="group" aria-labelledby="audience-label" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <GroupLabel id="audience-label">{t.targetAudience}</GroupLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ToggleRow
                    checked={form.targetThai}
                    label={t.thaiStudents}
                    onChange={() => {
                      const nextVal = !form.targetThai;
                      setForm({ ...form, targetThai: nextVal, ...(!nextVal && { quotaThai: "" }) });
                    }}
                  />
                  <ToggleRow
                    checked={form.targetInternational}
                    label={t.internationalStudents}
                    onChange={() => {
                      const nextVal = !form.targetInternational;
                      setForm({ ...form, targetInternational: nextVal, ...(!nextVal && { quotaInternational: "" }) });
                    }}
                  />
                </div>
                {(form.targetThai || form.targetInternational) && (
                  <div className="grid gap-4" style={{ gridTemplateColumns: form.targetThai && form.targetInternational ? "repeat(auto-fit, minmax(200px, 1fr))" : "1fr" }}>
                    {form.targetThai && (
                      <Field label={t.thaiStudentQuota}>
                        {(p) => (
                          <IconInput icon={<Users size={18} />}>
                            <input {...p} className="input" type="number" inputMode="numeric" min={0} value={form.quotaThai} onChange={(e) => set("quotaThai", e.target.value)} placeholder={t.unlimitedIfEmpty} style={{ paddingLeft: 44 }} />
                          </IconInput>
                        )}
                      </Field>
                    )}
                    {form.targetInternational && (
                      <Field label={t.intlStudentQuota}>
                        {(p) => (
                          <IconInput icon={<Users size={18} />}>
                            <input {...p} className="input" type="number" inputMode="numeric" min={0} value={form.quotaInternational} onChange={(e) => set("quotaInternational", e.target.value)} placeholder={t.unlimitedIfEmpty} style={{ paddingLeft: 44 }} />
                          </IconInput>
                        )}
                      </Field>
                    )}
                  </div>
                )}
              </div>

              {/* First-Year Students Only */}
              <ToggleRow
                checked={form.firstYearOnly}
                label={t.firstYearOnly}
                hint={(t.firstYearOnlyHint || "").replace("{prefix}", currentFirstYearPrefix())}
                icon={<GraduationCap size={18} aria-hidden="true" style={{ flexShrink: 0, color: form.firstYearOnly ? "var(--accent-primary)" : "var(--text-muted)" }} />}
                onChange={() => set("firstYearOnly", !form.firstYearOnly)}
              />
            </div>
          </Panel>

          {/* 5. Event team — suggested helpers, drawn only from THIS club's
              own roster (GET /api/admin/clubs/[id]/members) or THIS
              president's own major (GET /api/admin/majors/[code]/members). Staff can
              freely add/remove people when creating the real event. */}
          <Panel title={t.adminCmGroupTeam} description={isClub ? t.adminCmStaffHintClub : t.adminCmStaffHintMajor}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {form.staffUserIds.length > 0 ? (
                <ul aria-label={t.adminCmStaffChosen} style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
                  {form.staffUserIds.map((uid) => (
                    <li
                      key={uid}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0 4px 0 12px", borderRadius: 99, fontSize: 13, fontWeight: 700, background: "rgb(var(--indigo-500-rgb) / 0.1)", color: "var(--indigo-600)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.25)" }}
                    >
                      {staffLabel(uid)}
                      <IconButton
                        size="sm"
                        label={t.adminCmRemoveStaff.replace("{name}", staffLabel(uid))}
                        icon={<X size={14} />}
                        onClick={() => set("staffUserIds", form.staffUserIds.filter((x) => x !== uid))}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.adminCmNoStaffYet}</p>
              )}
              <Field label={t.adminCmStaffSearchLabel}>
                {(p) => (
                  <input
                    {...p}
                    type="search"
                    autoComplete="off"
                    className="input"
                    placeholder={isClub ? t.adminCmStaffSearchClub : t.adminCmStaffSearchMajor}
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                  />
                )}
              </Field>
              {staffQuery.length > 0 && (
                <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                  {staffMatches.map((u) => {
                    const on = form.staffUserIds.includes(u.userId);
                    const posKey = u.position ? (POSITION_I18N_KEY[u.position as keyof typeof POSITION_I18N_KEY] as keyof typeof t | undefined) : undefined;
                    return (
                      <button
                        key={u.userId}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("staffUserIds", on ? form.staffUserIds.filter((x) => x !== u.userId) : [...form.staffUserIds, u.userId])}
                        style={{ display: "flex", width: "100%", minHeight: 44, alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgb(var(--indigo-500-rgb) / 0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 14, color: "inherit", font: "inherit" }}
                      >
                        <span style={{ fontWeight: 700 }}>
                          {u.name || "—"}{" "}
                          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                            · {u.studentId || u.role || ""}{posKey ? ` · ${t[posKey]}` : ""}
                          </span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: on ? "var(--indigo-600)" : "var(--accent-primary)", flexShrink: 0 }}>
                          {on ? `✓ ${t.adminCmAdded}` : `+ ${t.adminCmAdd}`}
                        </span>
                      </button>
                    );
                  })}
                  {staffMatches.length === 0 && (
                    <p style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>
                      {loadingMembers
                        ? t.adminCmLoadingMembers
                        : staffCandidates.length === 0
                          ? (isClub ? t.adminCmNoClubMembers : t.adminCmNoMajorStudents)
                          : t.adminCmNoStudentMatch}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* 6. Suggested Access — role/major/club eligibility, entirely
              non-binding. Staff explicitly reviews/adjusts this when
              creating the real event (see the fromProposal prefill in
              admin/events/page.tsx) — nothing here takes effect on its
              own, so leaving everything unchecked (= open to everyone) is
              always a safe default. Collapsed by default (rarely needed). */}
          <Panel
            title={t.adminCmGroupAccess}
            description={t.adminCmGroupAccessDesc}
            actions={
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={showAccess}
                aria-controls="proposal-access-body"
                onClick={() => setShowAccess((v) => !v)}
              >
                {showAccess ? t.adminCmHide : t.adminCmShow}
                {showAccess ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              </button>
            }
          >
            <div id="proposal-access-body" hidden={!showAccess}>
              {showAccess && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div role="group" aria-labelledby="access-role-label" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <GroupLabel id="access-role-label">{t.adminCmAccessByRole}</GroupLabel>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ALL_PARTICIPANT_ROLES.map((role) => {
                        const isSelected = form.allowedRoles.includes(role);
                        return (
                          <ChipToggle
                            key={role}
                            selected={isSelected}
                            onClick={() => set("allowedRoles", isSelected ? form.allowedRoles.filter((r) => r !== role) : [...form.allowedRoles, role])}
                          >
                            {ROLE_LABELS[role]}
                          </ChipToggle>
                        );
                      })}
                    </div>
                  </div>

                  <div role="group" aria-labelledby="access-major-label" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <GroupLabel id="access-major-label">{t.adminCmAccessByMajor}</GroupLabel>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ALL_MAJORS.map((major) => {
                        const isSelected = form.allowedMajors.includes(major);
                        return (
                          <ChipToggle
                            key={major}
                            tone="accent"
                            selected={isSelected}
                            onClick={() => set("allowedMajors", isSelected ? form.allowedMajors.filter((m) => m !== major) : [...form.allowedMajors, major])}
                          >
                            {major}
                          </ChipToggle>
                        );
                      })}
                    </div>
                  </div>

                  {isClub && (
                    <div role="group" aria-labelledby="access-club-label" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <GroupLabel id="access-club-label">{t.adminCmAccessByClub}</GroupLabel>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {activeClubs.length === 0 ? (
                          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.adminCmNoClubsToChoose}</p>
                        ) : activeClubs.map((c) => {
                          const isSelected = form.allowedClubs.includes(c.id);
                          return (
                            <ChipToggle
                              key={c.id}
                              tone="violet"
                              selected={isSelected}
                              onClick={() => set("allowedClubs", isSelected ? form.allowedClubs.filter((id) => id !== c.id) : [...form.allowedClubs, c.id])}
                            >
                              {c.name}
                            </ChipToggle>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* 7. Event Poster */}
          <Panel
            title={t.eventPosterLabel}
            description={t.adminCmPosterDesc}
            actions={form.imageUrls.length > 0 ? <StatusBadge tone="accent" icon={false}>{form.imageUrls.length}</StatusBadge> : undefined}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {form.imageUrls.length > 0 && (
                <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12, margin: 0, padding: 0, listStyle: "none" }}>
                  {form.imageUrls.map((url, idx) => (
                    <li key={url + idx} style={{ position: "relative", aspectRatio: "4/5", borderRadius: 16, overflow: "hidden", background: "var(--black)", border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-medium)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={t.adminCmPosterN.replace("{n}", String(idx + 1))} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      {idx === 0 && (
                        <span style={{ position: "absolute", top: 8, left: 8 }}>
                          <StatusBadge tone="accent" icon={false}>{t.adminCmCover}</StatusBadge>
                        </span>
                      )}
                      <IconButton
                        size="sm"
                        tone="danger"
                        label={t.adminCmRemovePoster.replace("{n}", String(idx + 1))}
                        icon={<X size={16} />}
                        onClick={() => removePoster(idx)}
                        style={{ position: "absolute", top: 4, right: 4, background: "var(--bg-surface)" }}
                      />
                      <div style={{ position: "absolute", bottom: 4, left: 4, right: 4, display: "flex", justifyContent: "space-between", gap: 6 }}>
                        <IconButton
                          size="sm"
                          label={t.adminCmMovePosterEarlier.replace("{n}", String(idx + 1))}
                          icon={<ChevronLeft size={16} />}
                          onClick={() => movePoster(idx, -1)}
                          disabled={idx === 0}
                          style={{ background: "var(--bg-surface)" }}
                        />
                        <IconButton
                          size="sm"
                          label={t.adminCmMovePosterLater.replace("{n}", String(idx + 1))}
                          icon={<ChevronRight size={16} />}
                          onClick={() => movePoster(idx, 1)}
                          disabled={idx === form.imageUrls.length - 1}
                          style={{ background: "var(--bg-surface)" }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                disabled={posterBusy}
                onClick={() => posterFileRef.current?.click()}
                style={{
                  width: "100%",
                  minHeight: form.imageUrls.length > 0 ? 96 : 144,
                  background: "var(--bg-elevated)",
                  borderRadius: 16,
                  border: "2px dashed var(--border-medium)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: 16,
                  cursor: posterBusy ? "wait" : "pointer",
                  color: "var(--text-secondary)",
                  font: "inherit",
                }}
              >
                {posterBusy ? (
                  <>
                    <RefreshCw size={24} className="animate-spin" aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
                    <span role="status" style={{ fontSize: 14, fontWeight: 700 }}>{t.adminCmPosterUploading.replace("{n}", String(posterUploading))}</span>
                  </>
                ) : (
                  <>
                    <Plus size={form.imageUrls.length > 0 ? 20 : 26} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {form.imageUrls.length > 0 ? t.adminCmPosterAddMore : t.adminCmPosterUpload}
                    </span>
                    {form.imageUrls.length === 0 && (
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.adminCmPosterRecommended}</span>
                    )}
                  </>
                )}
              </button>
              <input
                ref={posterFileRef}
                type="file"
                accept="image/*"
                multiple
                aria-label={t.eventPosterLabel}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const input = e.target;
                  const files = input.files;
                  if (!files || files.length === 0) return;
                  await addPosters(files);
                  input.value = "";
                }}
              />
            </div>
          </Panel>
        </div>
      </Modal>

      {/* Details view — read-only. Lets the proposer re-check exactly what was
          submitted (most importantly the FULL per-day schedule: `sessions`, when
          present, holds EVERY day — mirrors admin/events/page.tsx — with the
          Start/End fields above as the overall display range; see the "days"
          badge in the list above, which is just sessions.length) against what
          the summary badges show. */}
      <Modal
        open={!!viewingProposal}
        onClose={() => setViewingProposal(null)}
        size="lg"
        icon={<CalendarPlus size={20} />}
        title={viewingProposal?.title ?? ""}
        description={
          viewingProposal
            ? `${scopeName(viewingProposal)} · ${t.adminProposalsRequestedByLabel} ${viewingProposal.proposer.name}${viewingProposal.proposer.studentId ? ` (${viewingProposal.proposer.studentId})` : ""}`
            : undefined
        }
        footer={
          viewingProposal && (
            <>
              {viewingProposal.status === "pending" && (
                // Destructive: pushed to the far side, away from Close.
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--red-600)", marginRight: "auto" }}
                  disabled={withdrawingId === viewingProposal.id}
                  onClick={() => withdraw(viewingProposal)}
                >
                  {withdrawingId === viewingProposal.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                  {t.adminProposalsWithdrawButton}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setViewingProposal(null)}>
                {t.adminUiClose}
              </button>
              {viewingProposal.status === "rejected" && (
                <button className="btn btn-primary" onClick={() => openEditResubmit(viewingProposal)}>
                  <Edit2 size={14} aria-hidden="true" />
                  {t.adminProposalsResubmitButton}
                </button>
              )}
            </>
          )
        }
      >
        {viewingProposal && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>{statusBadge(viewingProposal.status)}</div>

            {(viewingProposal.imageUrls?.[0] || viewingProposal.imageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewingProposal.imageUrls?.[0] || viewingProposal.imageUrl || ""}
                alt=""
                style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 16 }}
              />
            )}

            {viewingProposal.description && (
              <div
                className="custom-scrollbar"
                style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-primary)" }}
                dangerouslySetInnerHTML={{ __html: parseRichText(viewingProposal.description) }}
              />
            )}

            {/* Full schedule — when `sessions` holds 2+ days it's the
                complete per-day breakdown (mirrors admin/events/page.tsx);
                otherwise this is a plain single-day proposal and the
                Start/End fields alone are the whole schedule. */}
            <div>
              <p className="adm-field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Clock size={16} aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
                {t.sessionsHeading}
                <span style={{ fontWeight: 500, color: "var(--text-muted)" }}>
                  · {dayWord(viewingProposal.sessions && viewingProposal.sessions.length > 1 ? viewingProposal.sessions.length : 1)}
                </span>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {viewingProposal.sessions && viewingProposal.sessions.length > 1 ? (
                  viewingProposal.sessions.map((s, idx) => (
                    <div key={idx} style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>
                        {s.title || t.adminCmDayN.replace("{n}", String(idx + 1))}
                      </span>
                      <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                        {new Date(s.startTime).toLocaleString()} – {new Date(s.endTime).toLocaleString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: "10px 14px" }}>
                    <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                      {new Date(viewingProposal.startTime).toLocaleString()} – {new Date(viewingProposal.endTime).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {viewingProposal.location && (
                <div>
                  <p className="adm-field-label">{t.adminProposalsLocationLabel}</p>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{viewingProposal.location}</p>
                </div>
              )}
              <div>
                <p className="adm-field-label">{t.adminProposalsQuotaLabel}</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{viewingProposal.quota ?? t.adminCmUnlimited}</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {viewingProposal.walkInsOnly
                ? subtleBadge("walk", t.walkInsOnlyBadge)
                : viewingProposal.walkInsEnabled && subtleBadge("walk", t.allowWalkins)}
              {viewingProposal.firstYearOnly && subtleBadge("fy", t.firstYearOnly)}
              {viewingProposal.targetThai && subtleBadge("th", `${t.thaiStudents}${viewingProposal.quotaThai ? ` (${viewingProposal.quotaThai})` : ""}`)}
              {viewingProposal.targetInternational && subtleBadge("intl", `${t.internationalStudents}${viewingProposal.quotaInternational ? ` (${viewingProposal.quotaInternational})` : ""}`)}
              {viewingProposal.staffUserIds && viewingProposal.staffUserIds.length > 0 && subtleBadge("staff", staffWord(viewingProposal.staffUserIds.length))}
            </div>

            {viewingProposal.reviewNote && viewingProposal.status === "rejected" ? (
              <InlineAlert tone="error" title={t.adminProposalsRejectReasonLabel}>{viewingProposal.reviewNote}</InlineAlert>
            ) : viewingProposal.reviewNote && (
              <div>
                <p className="adm-field-label">{t.adminCmReviewerNote}</p>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{viewingProposal.reviewNote}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
