"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { currentFirstYearPrefix } from "@/lib/access/event-access";
import { sessionSpansTooLong, splitIntoDailySessions } from "@/lib/events/event-schema";
import { parseRichText } from "@/lib/ui/rich-text";
import { POSITION_I18N_KEY } from "@/lib/access/positions";
import {
  AlertCircle,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  ExternalLink,
  Eye,
  GraduationCap,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
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
} from "../_propose-event/shared";

type Club = { id: string; name: string; isArchived: boolean };

type ClubMember = { id: string; userId: string; role: string; userName: string | null; studentId: string | null; position: string | null };

type Proposal = ProposalBase & {
  clubId: string;
  allowedClubs: string[] | null;
  club: { id: string; name: string };
};

const EMPTY_FORM = {
  ...EMPTY_FORM_BASE,
  clubId: "",
  allowedClubs: [] as string[],
};


// club_president-only section on the clubs page: submit a request for an
// event. All requested fields (title/time/audience/poster/staff/etc.) are
// non-binding suggestions — staff still decides pointsAwarded/allowedRoles/
// allowedMajors/managedByRoles/ownerClubIds explicitly when creating the real
// event from an approved proposal (see POST /api/admin/events' proposalId
// linkage). Own-club-scoped end to end: the clubs prop is already the clubs
// THIS president presides over (from the page's own scoped GET
// /api/admin/clubs), the proposals list/withdraw APIs independently
// re-verify ownership server-side, and the suggested Event Staff picker below
// only ever reads the SAME club's own member roster (GET
// /api/admin/clubs/[id]/members) — never the global student directory.
// Custom club picker — replaces a native <select> so the option list gets the
// app's own styling (and isn't rendered by the OS, which on iOS/Android looks
// jarringly different from the rest of the form). Fully touch/keyboard
// friendly: a full-width trigger button + an absolutely-positioned, internally
// scrollable panel that never exceeds the trigger's own width, so it never
// causes horizontal overflow on narrow phone/iPad viewports. Closes on any
// outside click/tap.
function ClubDropdown({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        className="input"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          padding: "16px 20px",
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          cursor: "pointer",
          textAlign: "left",
          borderColor: open ? "var(--accent-primary)" : undefined,
          boxShadow: open ? "0 0 0 3px var(--accent-glow)" : undefined,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          style={{ color: "var(--text-muted)", flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="animate-fade-in-up custom-scrollbar"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 8px)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-medium)",
            borderRadius: 16,
            boxShadow: "0 16px 48px rgb(var(--shadow-rgb) / 0.18), 0 4px 16px rgb(var(--shadow-rgb) / 0.08)",
            zIndex: 20,
            maxHeight: 260,
            overflowY: "auto",
            padding: 6,
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  minHeight: 44,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: isSelected ? "rgb(var(--accent-rgb) / 0.1)" : "transparent",
                  color: isSelected ? "var(--accent-primary)" : "var(--text-secondary)",
                  fontWeight: isSelected ? 800 : 600,
                  fontSize: 14,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
                {isSelected && <Check size={15} style={{ flexShrink: 0, marginLeft: 8 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Stable per-club accent color, cycling through a fixed qualitative palette
// by the club's position in `activeClubs` — lets a president who presides
// over several clubs visually tell proposals apart at a glance (group header
// dot + matching card border) without relying on reading the club name text.
const CLUB_ACCENT_COLORS = ["var(--indigo-500)", "var(--green-500)", "var(--amber-500)", "var(--pink-500)", "var(--cyan-500)", "var(--violet-500)", "var(--red-500)", "var(--teal-500)"];

export function ProposeEventSection({ clubs }: { clubs: Club[] }) {
  const { t, lang } = useLanguage();
  const activeClubs = clubs.filter((c) => !c.isArchived);
  const clubColor = (clubId: string) => {
    const idx = activeClubs.findIndex((c) => c.id === clubId);
    return CLUB_ACCENT_COLORS[(idx < 0 ? 0 : idx) % CLUB_ACCENT_COLORS.length];
  };

  const STATUS_BADGE: Record<Proposal["status"], { bg: string; color: string; label: string }> = {
    pending: { bg: "rgb(var(--amber-500-rgb) / 0.1)", color: "var(--amber-500)", label: t.adminProposalsFilterPending },
    approved: { bg: "rgb(var(--green-500-rgb) / 0.1)", color: "var(--green-500)", label: t.adminProposalsFilterApproved },
    rejected: { bg: "rgb(var(--red-500-rgb) / 0.1)", color: "var(--red-500)", label: t.adminProposalsFilterRejected },
    withdrawn: { bg: "rgb(var(--slate-400-rgb) / 0.15)", color: "var(--slate-500)", label: t.adminProposalsFilterWithdrawn },
  };

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
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

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, val: typeof EMPTY_FORM[K]) => setForm((f) => ({ ...f, [key]: val }));

  const load = () => {
    // ?type=club: this page only ever renders club-owned proposals (each card
    // assumes a non-null `club` relation) — a president who also holds
    // major_president would otherwise get major-owned rows mixed in here too,
    // since the unfiltered endpoint returns everything the viewer can see.
    fetch("/api/admin/event-proposals?type=club")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setProposals(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, []);

  const openForm = () => {
    setEditingProposalId(null);
    setForm({ ...EMPTY_FORM, clubId: activeClubs[0]?.id ?? "" });
    setFormError(null);
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
      clubId: p.clubId,
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

  // The form scrolls inside a fixed-height modal (see the portal below), not
  // the full page — so revealing the Days section or adding a row can push
  // the newly-added content (and the "+Add day" button itself) below the
  // modal's own visible fold with no automatic scroll. Without this it reads
  // as "I clicked and nothing happened."
  const daysSectionRef = useRef<HTMLDivElement>(null);
  const addDayButtonRef = useRef<HTMLButtonElement>(null);
  const prevSessionsLength = useRef(0);

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

  // ---- Event Staff picker: THIS club's own roster only (never the global
  // student directory — see the component-level comment above). Reloads
  // whenever the selected club changes. ----
  const [clubMembers, setClubMembers] = useState<ClubMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");

  useEffect(() => {
    if (!showForm || !form.clubId) return;
    const timer = setTimeout(() => {
      setLoadingMembers(true);
      fetch(`/api/admin/clubs/${form.clubId}/members`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => { if (Array.isArray(d)) setClubMembers(d); })
        .catch(() => {})
        .finally(() => setLoadingMembers(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [showForm, form.clubId]);

  // ---- Rich text description toolbar (bold / link / color) — mirrors the
  // staff create-event description editor byte-for-byte so proposal text
  // renders identically once approved. See src/lib/rich-text.ts. ----
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
      setTimeout(() => { el.focus(); el.setSelectionRange(start, start + block.length); }, 10);
      return;
    }

    if (prefix !== "" && selected.startsWith(prefix) && selected.endsWith(suffix)) {
      const unwrapped = selected.substring(prefix.length, selected.length - suffix.length);
      set("description", before + unwrapped + after);
      setTimeout(() => { el.focus(); el.setSelectionRange(start, start + unwrapped.length); }, 10);
      return;
    }

    if (prefix === "**" && before.endsWith("**") && after.startsWith("**")) {
      set("description", before.slice(0, -2) + selected + after.slice(2));
      setTimeout(() => { el.focus(); el.setSelectionRange(start - 2, end - 2); }, 10);
      return;
    }

    const content = selected || (prefix === "**" ? "bold text" : "text");
    const newText = before + prefix + content + suffix + after;
    set("description", newText);

    const finalStart = start;
    const finalEnd = start + prefix.length + content.length + suffix.length;
    setTimeout(() => { el.focus(); el.setSelectionRange(finalStart, finalEnd); }, 10);
  };

  // ---- Poster upload — mirrors the staff create-event multi-poster pipeline
  // (client-side compress to WebP, then POST /api/upload; server re-checks
  // the 5MB cap / magic bytes regardless — see CLAUDE.md). ----
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

  const submit = async () => {
    if (!form.clubId || !form.title.trim() || !form.startTime || !form.endTime) {
      setFormError("Club, title, start time, and end time are required.");
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
    try {
      const isResubmit = editingProposalId !== null;
      const res = await fetch(
        isResubmit ? `/api/admin/event-proposals/${editingProposalId}` : "/api/admin/event-proposals",
        {
          method: isResubmit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(isResubmit ? { action: "resubmit" } : { clubId: form.clubId }),
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
          allowedClubs: form.allowedClubs.length > 0 ? form.allowedClubs : undefined,
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
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.error) || (isResubmit ? t.adminProposalsResubmitError : t.adminProposalsSubmitError));
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setRegistrationMode(null);
      setSessions([]);
      setEditingProposalId(null);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : (editingProposalId ? t.adminProposalsResubmitError : t.adminProposalsSubmitError));
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (id: string) => {
    if (!confirm(t.adminProposalsWithdrawConfirm)) return;
    setWithdrawingId(id);
    try {
      const res = await fetch(`/api/admin/event-proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      if (res.ok) load();
    } finally {
      setWithdrawingId(null);
    }
  };

  const checkboxRow = (checked: boolean, onClick: () => void, label: string, hint?: string, icon?: ReactNode) => (
    <div
      onClick={onClick}
      style={{
        minHeight: 48,
        background: "var(--bg-elevated)",
        borderRadius: 16,
        display: "flex",
        alignItems: hint ? "flex-start" : "center",
        gap: 12,
        padding: hint ? "12px 16px" : "0 16px",
        height: hint ? "auto" : 48,
        cursor: "pointer",
        border: checked ? "1px solid var(--accent-primary)" : "1px solid transparent",
        transition: "all 0.2s",
      }}
    >
      <div style={{
        width: 24, height: 24, flexShrink: 0, borderRadius: 6,
        border: "2px solid var(--border-medium)",
        background: checked ? "var(--accent-primary)" : "transparent",
        borderColor: checked ? "var(--accent-primary)" : "var(--border-medium)",
        display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s",
      }}>
        {checked && <CheckCircle2 size={16} color="white" />}
      </div>
      {icon}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: checked ? "var(--text-primary)" : "var(--text-secondary)" }}>{label}</span>
        {hint && <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{hint}</span>}
      </div>
    </div>
  );

  return (
    <div
      className="bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
      style={{ borderRadius: 32, padding: 24, marginBottom: 24 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <CalendarPlus size={20} style={{ color: "var(--accent-primary)" }} />
          {t.adminProposalsClubTitle}
        </h2>
        {activeClubs.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={openForm}>
            {t.adminProposalsSectionTitle}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      ) : proposals.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontWeight: 600, fontSize: 13 }}>{t.adminProposalsEmptyMessage}</p>
      ) : (() => {
        const renderCard = (p: Proposal, accent?: string) => {
          const badge = STATUS_BADGE[p.status];
          const poster = p.imageUrls?.[0] || p.imageUrl;
          return (
            <div
              key={p.id}
              onClick={() => setViewingProposal(p)}
              style={{
                background: "var(--bg-elevated)",
                borderRadius: 16,
                padding: "12px 16px",
                display: "flex",
                gap: 12,
                cursor: "pointer",
                borderLeft: accent ? `3px solid ${accent}` : undefined,
              }}
            >
              {poster && (
                <img src={poster} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {p.club.name} · {new Date(p.startTime).toLocaleString()}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {t.adminProposalsRequestedByLabel} {p.proposer.name}{p.proposer.studentId ? ` (${p.proposer.studentId})` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, height: "fit-content" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                    <Eye size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  </div>
                </div>
                {(p.walkInsEnabled || p.firstYearOnly || (p.staffUserIds && p.staffUserIds.length > 0) || (p.sessions && p.sessions.length > 1)) && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {p.sessions && p.sessions.length > 1 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--bg-surface)", color: "var(--text-muted)" }}>
                        {p.sessions.length} {lang === "th" ? "วัน" : "days"}
                      </span>
                    )}
                    {p.walkInsOnly ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--bg-surface)", color: "var(--text-muted)" }}>{t.walkInsOnlyBadge}</span>
                    ) : p.walkInsEnabled && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--bg-surface)", color: "var(--text-muted)" }}>{t.allowWalkins}</span>
                    )}
                    {p.firstYearOnly && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--bg-surface)", color: "var(--text-muted)" }}>{t.firstYearOnly}</span>
                    )}
                    {p.staffUserIds && p.staffUserIds.length > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--bg-surface)", color: "var(--text-muted)" }}>
                        {p.staffUserIds.length} {lang === "th" ? "ทีมงาน" : "staff"}
                      </span>
                    )}
                  </div>
                )}
                {p.reviewNote && p.status === "rejected" ? (
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8,
                    background: "rgb(var(--red-500-rgb) / 0.08)", border: "1px solid rgb(var(--red-500-rgb) / 0.2)",
                    borderRadius: 12, padding: "8px 12px",
                  }}>
                    <AlertCircle size={14} style={{ color: "var(--red-500)", flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <p style={{ fontSize: 10.5, fontWeight: 800, color: "var(--red-500)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        {t.adminProposalsRejectReasonLabel}
                      </p>
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>{p.reviewNote}</p>
                    </div>
                  </div>
                ) : p.reviewNote && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{p.reviewNote}</p>
                )}
                {p.status === "pending" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 8, color: "var(--red-500)" }}
                    disabled={withdrawingId === p.id}
                    onClick={(e) => { e.stopPropagation(); withdraw(p.id); }}
                  >
                    {withdrawingId === p.id ? <Loader2 size={13} className="animate-spin" /> : null}
                    {t.adminProposalsWithdrawButton}
                  </button>
                )}
                {p.status === "rejected" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 8, color: "var(--accent-primary)" }}
                    onClick={(e) => { e.stopPropagation(); openEditResubmit(p); }}
                  >
                    <Edit2 size={13} />
                    {t.adminProposalsResubmitButton}
                  </button>
                )}
              </div>
            </div>
          );
        };

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
                  <div key={club.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <h3 style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        {club.name}
                      </h3>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: 999 }}>
                        {items.length}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {items.map((p) => renderCard(p, color))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {proposals.map((p) => renderCard(p))}
          </div>
        );
      })()}

      {/* Portaled to document.body: the page wrapper this section lives inside
          (ClubsPage's `animate-fade-in-up` div) keeps a residual `transform:
          translateY(0)` after its entrance animation finishes (fill-mode:
          both), which makes it the containing block for any `position: fixed`
          descendant — clipping/mispositioning this modal to that div's box
          instead of the viewport. A portal escapes that regardless of where
          this component gets mounted in the future. */}
      {showForm && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(var(--scrim-rgb) / 0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "clamp(12px, 4vw, 24px)",
          }}
          onClick={() => !submitting && setShowForm(false)}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "100%",
              maxWidth: 640,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: "clamp(20px, 4vw, 32px)",
              overflow: "hidden",
              boxShadow: "0 40px 80px rgb(var(--shadow-rgb) / 0.2)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <div style={{ padding: "24px 32px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <h3 style={{ fontSize: "clamp(20px, 4vw, 24px)", fontWeight: 900, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 10, height: 28, background: "var(--accent-primary)", borderRadius: 5 }} />
                {editingProposalId ? t.adminProposalsResubmitTitle : t.adminProposalsSectionTitle}
              </h3>
              <button className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }} onClick={() => setShowForm(false)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24, overflowY: "auto", flex: 1 }}>
              {activeClubs.length > 1 && (
                <div className="field">
                  <label className="label">{t.adminProposalsClubLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                  {editingProposalId ? (
                    // Club is fixed once a proposal exists — resubmitting only
                    // edits its content, not which club it belongs to.
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                      {activeClubs.find((c) => c.id === form.clubId)?.name ?? form.clubId}
                    </p>
                  ) : (
                    <ClubDropdown
                      value={form.clubId}
                      options={activeClubs.map((c) => ({ value: c.id, label: c.name }))}
                      onChange={(clubId) => setForm({ ...form, clubId, staffUserIds: [] })}
                      placeholder={t.adminProposalsClubLabel}
                    />
                  )}
                </div>
              )}
              <div className="field">
                <label className="label">{t.adminProposalsTitleLabel} <span style={{ color: "var(--accent-primary)" }}>*</span></label>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} style={{ fontSize: 16, padding: "16px 20px", borderRadius: 16 }} />
              </div>

              {/* Description — rich text toolbar + live preview, byte-for-byte
                  the same markup syntax as the staff create-event form. */}
              <div className="field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label className="label" style={{ marginBottom: 0 }}>{t.adminProposalsDescriptionLabel}</label>
                  <div style={{ display: "flex", gap: 4, background: "var(--bg-elevated)", padding: 2, borderRadius: 10 }}>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("**", "**")}><Edit2 size={14} /></button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }} onClick={() => injectMarkup("[", "](https://...)")}><ExternalLink size={14} /></button>
                    <div style={{ position: "relative" }}>
                      <input type="color" defaultValue="#ff6b00" style={{ opacity: 0, position: "absolute", inset: 0, cursor: "pointer" }} onChange={(e) => injectMarkup(`{{color:${e.target.value}|`, "}}")} />
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 6, border: "none" }}>
                        <span style={{ width: 14, height: 14, borderRadius: 4, background: "linear-gradient(135deg,var(--red-500),var(--indigo-500))", display: "inline-block" }} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-auto md:h-[200px]">
                  <textarea
                    ref={textareaRef}
                    className="input h-[160px] md:h-full"
                    style={{ resize: "none", borderRadius: 16, background: "var(--bg-elevated)", border: "none", fontSize: 14, padding: 16 }}
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    maxLength={2000}
                    placeholder={lang === "th" ? "อธิบายรายละเอียดเกี่ยวกับกิจกรรม..." : "Tell them about the event..."}
                  />
                  <div
                    className="custom-scrollbar h-[160px] md:h-full"
                    style={{ background: "var(--bg-elevated)", borderRadius: 16, padding: 16, fontSize: 14, lineHeight: 1.6, overflowY: "auto", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.05em" }}>
                      {lang === "th" ? "ตัวอย่างการแสดงผล" : "Live Preview"}
                    </p>
                    <div dangerouslySetInnerHTML={{ __html: parseRichText(form.description) || `<span style="color: var(--text-muted); font-style: italic;">${lang === "th" ? "ยังไม่มีเนื้อหา..." : "No content yet..."}</span>` }} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="field">
                  <label className="label">
                    {t.adminProposalsStartLabel} <span style={{ color: "var(--accent-primary)" }}>*</span>
                  </label>
                  <input
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
                </div>
                <div className="field">
                  <label className="label">
                    {t.adminProposalsEndLabel} <span style={{ color: "var(--accent-primary)" }}>*</span>
                  </label>
                  <input
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
                </div>
              </div>

              {registrationMode === null && sessionSpansTooLong(form.startTime, form.endTime) && (
                <div style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  background: "color-mix(in srgb, var(--amber-500) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--amber-500) 40%, transparent)",
                  borderRadius: 12, padding: "10px 14px",
                }}>
                  <AlertCircle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                      {t.multiDaySessionWarning}
                    </span>
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
                  <input className="input" type="datetime-local" lang="en-GB" value={form.registrationOpenTime} onChange={(e) => set("registrationOpenTime", e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t.eventRegistrationCloseLabel}</label>
                  <input className="input" type="datetime-local" lang="en-GB" value={form.registrationCloseTime} onChange={(e) => set("registrationCloseTime", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="field">
                  <label className="label">{t.adminProposalsLocationLabel}</label>
                  <div style={{ position: "relative" }}>
                    <MapPin size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                    <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={200} placeholder="CAMT Auditorium" style={{ paddingLeft: 44 }} />
                  </div>
                </div>
                <div className="field">
                  <label className="label">{t.adminProposalsQuotaLabel}</label>
                  <div style={{ position: "relative" }}>
                    <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                    <input className="input" type="number" min={0} value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} placeholder={t.unlimitedIfZero} style={{ paddingLeft: 44 }} />
                  </div>
                </div>
              </div>

              {/* Allow Walk-ins */}
              <div className="field">
                {checkboxRow(form.walkInsEnabled, () => {
                  if (form.walkInsOnly) return; // locked on while Walk-ins Only is set
                  const nextVal = !form.walkInsEnabled;
                  setForm({ ...form, walkInsEnabled: nextVal, ...(!nextVal && { quotaWalkIn: "" }) });
                }, t.allowWalkins)}
              </div>

              {/* Walk-ins Only — no pre-registration accepted at all. Implies
                  Allow Walk-ins. */}
              <div className="field">
                {checkboxRow(form.walkInsOnly, () => {
                  const nextVal = !form.walkInsOnly;
                  setForm({ ...form, walkInsOnly: nextVal, ...(nextVal && { walkInsEnabled: true }) });
                }, t.walkInsOnlyToggleLabel, t.walkInsOnlyToggleHint)}
              </div>

              {form.walkInsEnabled && !form.walkInsOnly && (
                <div className="field">
                  <label className="label">{t.walkInQuota}</label>
                  <div style={{ position: "relative" }}>
                    <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                    <input className="input" type="number" min={0} value={form.quotaWalkIn} onChange={(e) => set("quotaWalkIn", e.target.value)} placeholder={t.unlimitedIfEmpty} style={{ paddingLeft: 44 }} />
                  </div>
                </div>
              )}

              {/* Target Audience Eligibility */}
              <div className="field">
                <label className="label">{t.targetAudience}</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {checkboxRow(form.targetThai, () => {
                    const nextVal = !form.targetThai;
                    setForm({ ...form, targetThai: nextVal, ...(!nextVal && { quotaThai: "" }) });
                  }, t.thaiStudents)}
                  {checkboxRow(form.targetInternational, () => {
                    const nextVal = !form.targetInternational;
                    setForm({ ...form, targetInternational: nextVal, ...(!nextVal && { quotaInternational: "" }) });
                  }, t.internationalStudents)}
                </div>
                {(form.targetThai || form.targetInternational) && (
                  <div className="grid gap-5 mt-5" style={{ gridTemplateColumns: form.targetThai && form.targetInternational ? "repeat(auto-fit, minmax(200px, 1fr))" : "1fr" }}>
                    {form.targetThai && (
                      <div className="field">
                        <label className="label">{t.thaiStudentQuota}</label>
                        <div style={{ position: "relative" }}>
                          <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                          <input className="input" type="number" min={0} value={form.quotaThai} onChange={(e) => set("quotaThai", e.target.value)} placeholder={t.unlimitedIfEmpty} style={{ paddingLeft: 44 }} />
                        </div>
                      </div>
                    )}
                    {form.targetInternational && (
                      <div className="field">
                        <label className="label">{t.intlStudentQuota}</label>
                        <div style={{ position: "relative" }}>
                          <Users size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                          <input className="input" type="number" min={0} value={form.quotaInternational} onChange={(e) => set("quotaInternational", e.target.value)} placeholder={t.unlimitedIfEmpty} style={{ paddingLeft: 44 }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* First-Year Students Only */}
              <div className="field">
                {checkboxRow(
                  form.firstYearOnly,
                  () => set("firstYearOnly", !form.firstYearOnly),
                  t.firstYearOnly,
                  (t.firstYearOnlyHint || "").replace("{prefix}", currentFirstYearPrefix()),
                  <GraduationCap size={18} style={{ flexShrink: 0, color: form.firstYearOnly ? "var(--accent-primary)" : "var(--text-muted)" }} />
                )}
              </div>

              {/* How students register — click "Once" to opt into a multi-day
                  schedule (nothing selected by default, exactly like the staff
                  create-event form's registrationMode picker in
                  admin/events/page.tsx). 'per_session' is intentionally not
                  offered: the student registration flow has no per-day path yet. */}
              <div className="field">
                <label className="label">{t.registrationModeLabel}</label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>{t.registrationModeHint}</p>
                <div
                  onClick={() => {
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
                  style={{
                    minHeight: 48, background: "var(--bg-elevated)", borderRadius: 16, display: "flex",
                    alignItems: "flex-start", gap: 12, padding: "12px 16px", cursor: "pointer",
                    border: registrationMode === "once" ? "1px solid var(--accent-primary)" : "1px solid transparent",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{
                    width: 22, height: 22, flexShrink: 0, marginTop: 1, borderRadius: "50%",
                    border: registrationMode === "once" ? "2px solid var(--accent-primary)" : "2px solid var(--border-medium)",
                    display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s",
                  }}>
                    {registrationMode === "once" && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)" }} />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: registrationMode === "once" ? "var(--text-primary)" : "var(--text-secondary)" }}>{t.registrationModeOnce}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.4 }}>{t.registrationModeOnceDesc}</span>
                  </div>
                </div>
              </div>

              {/* Days / Sessions — only shown once "Once" is selected above
                  (multi-day event). At least one row is required once shown;
                  staff finalizes the real per-day sessions (and any walk-in
                  sub-quotas) when creating the event from this proposal. */}
              {registrationMode !== null && (
              <div className="field" ref={daysSectionRef}>
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock size={16} style={{ color: "var(--accent-primary)" }} />
                  {t.sessionsHeading}
                </label>
                <div style={{
                  display: "flex", gap: 8, alignItems: "flex-start", background: "var(--bg-elevated)",
                  border: "1px solid var(--accent-primary)", borderRadius: 12, padding: "10px 14px", marginBottom: 14,
                }}>
                  <Clock size={15} style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>{t.sessionsNoteOnce}</span>
                </div>
                {sessions.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
                    {sessions.map((s, idx) => (
                      <div
                        key={idx}
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
                            title={t.removeDay}
                            disabled={sessions.length <= 1}
                            style={{
                              width: 40, height: 40, flexShrink: 0, borderRadius: 12,
                              border: "1px solid var(--border-medium)", background: "transparent", color: "var(--red-500)",
                              cursor: sessions.length <= 1 ? "not-allowed" : "pointer",
                              opacity: sessions.length <= 1 ? 0.35 : 1,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.adminProposalsStartLabel}</label>
                            <input className="input" type="datetime-local" lang="en-GB" value={s.startTime} onChange={(e) => updateSessionRow(idx, { startTime: e.target.value })} />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" style={{ fontSize: 12 }}>{t.adminProposalsEndLabel}</label>
                            <input className="input" type="datetime-local" lang="en-GB" value={s.endTime} onChange={(e) => updateSessionRow(idx, { endTime: e.target.value })} />
                          </div>
                        </div>
                        {sessionSpansTooLong(s.startTime, s.endTime) && (
                          <div style={{
                            display: "flex", gap: 10, alignItems: "flex-start",
                            background: "color-mix(in srgb, var(--amber-500) 12%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--amber-500) 40%, transparent)",
                            borderRadius: 12, padding: "10px 14px",
                          }}>
                            <AlertCircle size={16} style={{ color: "var(--amber-500)", flexShrink: 0, marginTop: 2 }} />
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
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" ref={addDayButtonRef} onClick={addSessionRow} className="btn btn-ghost" style={{ gap: 8, borderRadius: 14 }}>
                  <Plus size={16} /> {t.addDay}
                </button>
              </div>
              )}

              {/* Event Staff — suggested helpers, drawn only from THIS club's
                  own roster (see GET /api/admin/clubs/[id]/members). Staff can
                  freely add/remove people when creating the real event. */}
              <div className="field">
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShieldCheck size={16} style={{ color: "var(--indigo-500)" }} />
                  {lang === "th" ? "ทีมงานของกิจกรรมนี้" : "Event Staff"}
                </label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                  {lang === "th"
                    ? "เลือกสมาชิกชมรมที่จะช่วยดูแลกิจกรรมนี้ (เป็นเพียงข้อเสนอแนะ ทีมงานฝ่ายจัดกิจกรรมสามารถปรับเปลี่ยนได้)"
                    : "Suggest club members to help staff this event. This is only a suggestion — staff can adjust it when creating the real event."}
                </p>
                {form.staffUserIds.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    {form.staffUserIds.map((uid) => {
                      const u = clubMembers.find((x) => x.userId === uid);
                      return (
                        <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 800, background: "rgb(var(--indigo-500-rgb) / 0.1)", color: "var(--indigo-500)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.25)" }}>
                          {u ? (u.userName || u.studentId || uid) : uid}
                          <button type="button" onClick={() => set("staffUserIds", form.staffUserIds.filter((x) => x !== uid))} style={{ background: "none", border: "none", color: "var(--indigo-500)", cursor: "pointer", fontWeight: 900, fontSize: 13, lineHeight: 1 }}>✕</button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", height: 42, borderRadius: 12, padding: "0 14px" }}
                  placeholder={lang === "th" ? "ค้นหาด้วยชื่อหรือรหัสนักศึกษา…" : "Search club members by name or student ID…"}
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                />
                {staffSearch.trim().length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                    {clubMembers
                      .filter((u) => {
                        const q = staffSearch.trim().toLowerCase();
                        return (u.userName || "").toLowerCase().includes(q) || (u.studentId || "").toLowerCase().includes(q);
                      })
                      .slice(0, 30)
                      .map((u) => {
                        const on = form.staffUserIds.includes(u.userId);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => set("staffUserIds", on ? form.staffUserIds.filter((x) => x !== u.userId) : [...form.staffUserIds, u.userId])}
                            style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgb(var(--indigo-500-rgb) / 0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                          >
                            <span style={{ fontWeight: 700 }}>{u.userName || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {u.studentId || u.role}{u.position ? ` · ${t[POSITION_I18N_KEY[u.position as keyof typeof POSITION_I18N_KEY] as keyof typeof t]}` : ""}</span></span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: on ? "var(--indigo-500)" : "var(--accent-primary)" }}>{on ? "✓ Added" : "+ Add"}</span>
                          </button>
                        );
                      })}
                    {clubMembers.length === 0 && (
                      <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>
                        {loadingMembers ? (lang === "th" ? "กำลังโหลดรายชื่อ…" : "Loading members…") : (lang === "th" ? "ไม่พบสมาชิกชมรม" : "No club members found.")}
                      </p>
                    )}
                  </div>
                )}
                {form.staffUserIds.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 10 }}>
                    {lang === "th" ? "ยังไม่ได้เสนอทีมงาน" : "No staff suggested yet."}
                  </p>
                )}
              </div>

              {/* Suggested Access — role/major/club eligibility, entirely
                  non-binding. Staff explicitly reviews/adjusts this when
                  creating the real event (see the fromProposal prefill in
                  admin/events/page.tsx) — nothing here takes effect on its
                  own, so leaving everything unchecked (= open to everyone) is
                  always a safe default. */}
              <div className="field">
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShieldCheck size={16} style={{ color: "var(--indigo-500)" }} />
                  {lang === "th" ? "สิทธิ์การเข้าร่วมที่แนะนำ" : lang === "cn" ? "建议的访问权限" : lang === "mm" ? "အကြံပြု ဝင်ရောက်ခွင့်" : "Suggested Access"}
                </label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, fontWeight: 600 }}>
                  {lang === "th"
                    ? "เป็นเพียงข้อเสนอแนะ — ทีมงานฝ่ายจัดกิจกรรมจะตรวจสอบและปรับเปลี่ยนได้ก่อนสร้างกิจกรรมจริง"
                    : lang === "cn"
                    ? "仅为建议——工作人员会在创建正式活动前审核并可调整。"
                    : lang === "mm"
                    ? "အကြံပြုချက်သာဖြစ်သည် — ဝန်ထမ်းများသည် တကယ့်ပွဲကို မဖန်တီးမီ စစ်ဆေးပြီး ပြင်ဆင်နိုင်သည်။"
                    : "Suggested only — staff reviews and can adjust this before the real event is created."}
                </p>

                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 8 }}>
                  {lang === "th" ? "ตามบทบาท" : lang === "cn" ? "按角色" : lang === "mm" ? "အခန်းကဏ္ဍအလိုက်" : "By role"}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {ALL_PARTICIPANT_ROLES.map((role) => {
                    const isSelected = form.allowedRoles.includes(role);
                    return (
                      <button
                        type="button"
                        key={role}
                        onClick={() => set("allowedRoles", isSelected ? form.allowedRoles.filter((r) => r !== role) : [...form.allowedRoles, role])}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99,
                          fontSize: 12, fontWeight: 800, cursor: "pointer",
                          background: isSelected ? "rgb(var(--indigo-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          color: isSelected ? "var(--indigo-500)" : "var(--text-secondary)",
                          border: `1px solid ${isSelected ? "rgb(var(--indigo-500-rgb) / 0.5)" : "transparent"}`,
                        }}
                      >
                        {isSelected && <CheckCircle2 size={12} />}
                        {ROLE_LABELS[role]}
                      </button>
                    );
                  })}
                </div>

                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 8 }}>
                  {lang === "th" ? "ตามสาขา" : lang === "cn" ? "按专业" : lang === "mm" ? "အထူးပြုဌာနအလိုက်" : "By major"}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {ALL_MAJORS.map((major) => {
                    const isSelected = form.allowedMajors.includes(major);
                    return (
                      <button
                        type="button"
                        key={major}
                        onClick={() => set("allowedMajors", isSelected ? form.allowedMajors.filter((m) => m !== major) : [...form.allowedMajors, major])}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99,
                          fontSize: 12, fontWeight: 800, cursor: "pointer",
                          background: isSelected ? "rgb(var(--accent-rgb) / 0.12)" : "var(--bg-elevated)",
                          color: isSelected ? "var(--accent-primary)" : "var(--text-secondary)",
                          border: `1px solid ${isSelected ? "rgb(var(--accent-rgb) / 0.5)" : "transparent"}`,
                        }}
                      >
                        {isSelected && <CheckCircle2 size={12} />}
                        {major}
                      </button>
                    );
                  })}
                </div>

                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 8 }}>
                  {lang === "th" ? "ตามชมรม" : lang === "cn" ? "按社团" : lang === "mm" ? "ကလပ်အလိုက်" : "By club"}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {activeClubs.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {lang === "th" ? "ไม่มีชมรมให้เลือก" : lang === "cn" ? "没有可选择的社团。" : lang === "mm" ? "ရွေးချယ်ရန် ကလပ် မရှိပါ။" : "No clubs to choose from."}
                    </p>
                  ) : activeClubs.map((c) => {
                    const isSelected = form.allowedClubs.includes(c.id);
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => set("allowedClubs", isSelected ? form.allowedClubs.filter((id) => id !== c.id) : [...form.allowedClubs, c.id])}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99,
                          fontSize: 12, fontWeight: 800, cursor: "pointer",
                          background: isSelected ? "rgb(var(--violet-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          color: isSelected ? "var(--violet-500)" : "var(--text-secondary)",
                          border: `1px solid ${isSelected ? "rgb(var(--violet-500-rgb) / 0.5)" : "transparent"}`,
                        }}
                      >
                        {isSelected && <CheckCircle2 size={12} />}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Event Poster */}
              <div className="field">
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {t.eventPosterLabel}
                  {form.imageUrls.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-primary)", background: "rgb(var(--accent-rgb) / 0.1)", padding: "2px 8px", borderRadius: 99 }}>
                      {form.imageUrls.length}
                    </span>
                  )}
                </label>

                {form.imageUrls.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12, marginBottom: 12 }}>
                    {form.imageUrls.map((url, idx) => (
                      <div key={url + idx} style={{ position: "relative", aspectRatio: "4/5", borderRadius: 16, overflow: "hidden", background: "var(--black)", border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-medium)" }}>
                        <img src={url} alt={`Poster ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        {idx === 0 && (
                          <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontWeight: 900, color: "var(--text-on-color)", background: "var(--accent-primary)", padding: "3px 7px", borderRadius: 99, letterSpacing: "0.05em", boxShadow: "0 2px 8px rgb(var(--shadow-rgb) / 0.3)" }}>
                            {lang === "th" ? "ปก" : "COVER"}
                          </span>
                        )}
                        <button type="button" onClick={() => removePoster(idx)} title={lang === "th" ? "ลบ" : "Remove"} style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(4px)" }}>
                          <X size={14} />
                        </button>
                        <div style={{ position: "absolute", bottom: 6, left: 6, right: 6, display: "flex", justifyContent: "space-between", gap: 6 }}>
                          <button type="button" onClick={() => movePoster(idx, -1)} disabled={idx === 0} title={lang === "th" ? "ย้ายไปด้านหน้า" : "Move left"} style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.35 : 1, backdropFilter: "blur(4px)" }}>
                            <ChevronLeft size={15} />
                          </button>
                          <button type="button" onClick={() => movePoster(idx, 1)} disabled={idx === form.imageUrls.length - 1} title={lang === "th" ? "ย้ายไปด้านหลัง" : "Move right"} style={{ width: 26, height: 26, borderRadius: 8, border: "none", background: "rgb(var(--scrim-rgb) / 0.6)", color: "var(--text-on-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === form.imageUrls.length - 1 ? "not-allowed" : "pointer", opacity: idx === form.imageUrls.length - 1 ? 0.35 : 1, backdropFilter: "blur(4px)" }}>
                            <ChevronRight size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{
                  position: "relative", height: form.imageUrls.length > 0 ? 110 : 160, background: "var(--bg-elevated)", borderRadius: 20,
                  border: "2px dashed var(--border-medium)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  overflow: "hidden", cursor: posterUploading > 0 ? "wait" : "pointer", transition: "all 0.2s",
                }} onClick={() => { if (posterUploading === 0) document.getElementById("proposal-poster-upload")?.click(); }}>
                  {posterUploading > 0 ? (
                    <div style={{ textAlign: "center", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                      <RefreshCw size={24} className="animate-spin" style={{ color: "var(--accent-primary)" }} />
                      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                        {lang === "th" ? `กำลังอัปโหลด ${posterUploading} ไฟล์...` : `Uploading ${posterUploading} image${posterUploading > 1 ? "s" : ""}...`}
                      </p>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: 20 }}>
                      <div style={{ width: form.imageUrls.length > 0 ? 40 : 56, height: form.imageUrls.length > 0 ? 40 : 56, borderRadius: "50%", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", color: "var(--text-muted)" }}>
                        <Plus size={form.imageUrls.length > 0 ? 20 : 26} />
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
                        {form.imageUrls.length > 0 ? (lang === "th" ? "เพิ่มโปสเตอร์" : "Add more posters") : (lang === "th" ? "อัปโหลดโปสเตอร์" : "Upload a poster")}
                      </p>
                      {form.imageUrls.length === 0 && (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>
                          {lang === "th" ? "แนะนำขนาด 1080x1080px (อัตราส่วน 1:1)" : "Recommended: 1080x1080px (1:1 Ratio)"}
                        </p>
                      )}
                    </div>
                  )}
                  <input
                    type="file"
                    id="proposal-poster-upload"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      await addPosters(files);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>

              {formError && <p style={{ color: "var(--red-500)", fontWeight: 600, fontSize: 13 }}>{formError}</p>}
            </div>
            <div style={{ padding: "16px 32px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)} disabled={submitting}>
                {t.adminProposalsCancelButton}
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {editingProposalId ? t.adminProposalsResubmitButton : t.adminProposalsSubmitButton}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Details view — read-only, portaled like the other modals. Lets the
          proposer re-check exactly what was submitted (most importantly the
          FULL per-day schedule: `sessions`, when present, holds EVERY day —
          mirrors admin/events/page.tsx — with the Start/End fields above as
          the overall display range; see the "days" badge in the list above,
          which is just sessions.length) against what the summary badges show. */}
      {viewingProposal && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(var(--scrim-rgb) / 0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "clamp(12px, 4vw, 24px)",
          }}
          onClick={() => setViewingProposal(null)}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "100%",
              maxWidth: 560,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: "clamp(20px, 4vw, 32px)",
              overflow: "hidden",
              boxShadow: "0 40px 80px rgb(var(--shadow-rgb) / 0.2)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <div style={{ padding: "24px 32px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexShrink: 0 }}>
              <div>
                <h3 style={{ fontSize: "clamp(18px, 3.5vw, 22px)", fontWeight: 900 }}>{viewingProposal.title}</h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginTop: 4 }}>{viewingProposal.club.name}</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>
                  {t.adminProposalsRequestedByLabel} {viewingProposal.proposer.name}{viewingProposal.proposer.studentId ? ` (${viewingProposal.proposer.studentId})` : ""}
                </p>
              </div>
              <button className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0, flexShrink: 0 }} onClick={() => setViewingProposal(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                  background: STATUS_BADGE[viewingProposal.status].bg, color: STATUS_BADGE[viewingProposal.status].color,
                }}>
                  {STATUS_BADGE[viewingProposal.status].label}
                </span>
              </div>

              {(viewingProposal.imageUrls?.[0] || viewingProposal.imageUrl) && (
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
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock size={16} style={{ color: "var(--accent-primary)" }} />
                  {t.sessionsHeading}
                  <span style={{ fontWeight: 700, color: "var(--text-muted)", fontSize: 12 }}>
                    · {viewingProposal.sessions && viewingProposal.sessions.length > 1 ? viewingProposal.sessions.length : 1} {lang === "th" ? "วัน" : "days"}
                  </span>
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {viewingProposal.sessions && viewingProposal.sessions.length > 1 ? (
                    viewingProposal.sessions.map((s, idx) => (
                      <div key={idx} style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>
                          {s.title || (lang === "th" ? `วันที่ ${idx + 1}` : `Day ${idx + 1}`)}
                        </span>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                          {new Date(s.startTime).toLocaleString()} – {new Date(s.endTime).toLocaleString()}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                        {new Date(viewingProposal.startTime).toLocaleString()} – {new Date(viewingProposal.endTime).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {viewingProposal.location && (
                  <div>
                    <label className="label">{t.adminProposalsLocationLabel}</label>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{viewingProposal.location}</p>
                  </div>
                )}
                <div>
                  <label className="label">{t.adminProposalsQuotaLabel}</label>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{viewingProposal.quota ?? (lang === "th" ? "ไม่จำกัด" : "Unlimited")}</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {viewingProposal.walkInsOnly ? (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{t.walkInsOnlyBadge}</span>
                ) : viewingProposal.walkInsEnabled && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{t.allowWalkins}</span>
                )}
                {viewingProposal.firstYearOnly && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{t.firstYearOnly}</span>
                )}
                {viewingProposal.targetThai && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {t.thaiStudents}{viewingProposal.quotaThai ? ` (${viewingProposal.quotaThai})` : ""}
                  </span>
                )}
                {viewingProposal.targetInternational && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {t.internationalStudents}{viewingProposal.quotaInternational ? ` (${viewingProposal.quotaInternational})` : ""}
                  </span>
                )}
                {viewingProposal.staffUserIds && viewingProposal.staffUserIds.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {viewingProposal.staffUserIds.length} {lang === "th" ? "ทีมงาน" : "staff suggested"}
                  </span>
                )}
              </div>

              {viewingProposal.reviewNote && viewingProposal.status === "rejected" ? (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  background: "rgb(var(--red-500-rgb) / 0.08)", border: "1px solid rgb(var(--red-500-rgb) / 0.2)",
                  borderRadius: 14, padding: "12px 16px",
                }}>
                  <AlertCircle size={16} style={{ color: "var(--red-500)", flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 800, color: "var(--red-500)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {t.adminProposalsRejectReasonLabel}
                    </p>
                    <p style={{ fontSize: 13.5, color: "var(--text-primary)", marginTop: 4, lineHeight: 1.5, fontWeight: 500 }}>{viewingProposal.reviewNote}</p>
                  </div>
                </div>
              ) : viewingProposal.reviewNote && (
                <div>
                  <label className="label">{lang === "th" ? "หมายเหตุจากทีมงาน" : "Reviewer note"}</label>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{viewingProposal.reviewNote}</p>
                </div>
              )}
            </div>

            <div style={{ padding: "16px 32px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
              {viewingProposal.status === "pending" && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--red-500)" }}
                  disabled={withdrawingId === viewingProposal.id}
                  onClick={() => { withdraw(viewingProposal.id); setViewingProposal(null); }}
                >
                  {withdrawingId === viewingProposal.id ? <Loader2 size={13} className="animate-spin" /> : null}
                  {t.adminProposalsWithdrawButton}
                </button>
              )}
              {viewingProposal.status === "rejected" && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => openEditResubmit(viewingProposal)}
                >
                  <Edit2 size={13} />
                  {t.adminProposalsResubmitButton}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setViewingProposal(null)}>
                {lang === "th" ? "ปิด" : "Close"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
