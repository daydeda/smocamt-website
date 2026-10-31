"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { effectiveRoles } from "@/lib/access/admin-access";
import { canonicalHouseName } from "@/lib/profile/faculties";
import { ProposeEventSection } from "../_propose-event/ProposeEventSection";
import { MedicalDetailPanel, type MemberMedical } from "../_roster/MedicalDetailPanel";
import { RosterList, type RosterRow } from "../_roster/RosterList";
import { EventFeedbackFormsShortcut } from "@/components/admin/EventFeedbackFormsShortcut";
import {
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  InlineAlert,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  TableScroll,
  Toolbar,
  useConfirm,
  useToast,
} from "@/components/admin/ui";
import { Archive, ArchiveRestore, Building2, Download, Pencil, Plus, Search, Trash2, Users } from "lucide-react";

type Club = {
  id: string;
  name: string;
  isArchived: boolean;
  createdAt: string;
  memberCount: number;
  presidentCount: number;
};

type ClubMember = {
  id: string;
  userId: string;
  role: string; // 'president' | 'member' — club_members row role, NOT the staff title below
  userName: string | null;
  nickname: string | null;
  studentId: string | null;
  major: string | null;
  phone: string | null;
  contactChannels: string | null;
  noShowCount: number;
  house: { id: string; name: string; color: string | null } | null;
  position: string | null; // staff title (src/lib/positions.ts) — global on users, distinct from `role`
};

// Medical/emergency-contact detail for ONE member — fetched on demand from
// GET .../members/[memberId]/medical (never bundled into the roster fetch
// above) only when that member's panel is expanded, and audit-logged as that
// specific student being viewed (see ClubsService.getClubMemberMedical).
// Emergency contacts are pre-redacted server-side to relationship + phone
// only (no contact name).
type ClubMemberMedical = MemberMedical;

type StudentOption = {
  id: string;
  name: string;
  studentId: string | null;
};

// Roster filter only appears once the list is long enough to need it.
const ROSTER_FILTER_MIN = 8;
const CLUB_SEARCH_MIN = 6;

export default function ClubsPage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  // All role checks below use the FULL role set (not just the singular primary
  // role) — a user holding club_president alongside a higher-priority role (e.g.
  // admin, registration, smo) would otherwise silently miss gates keyed on their
  // primary role (ROLE_PRIORITY in src/auth.ts ranks those above club_president),
  // since session.user.role only ever reflects the highest-priority one. The
  // server-side GET /api/admin/clubs mirrors this same full-set check.
  const userRoles = effectiveRoles(session?.user?.role, session?.user?.roles);
  const canManage = userRoles.includes("super_admin") || userRoles.includes("admin");
  // club_president gets read-only access to this page, scoped to just their own
  // club(s) — the list/members APIs already filter to that scope server-side, so
  // this flag only controls which buttons render (Members yes, Rename/Archive/
  // Delete no) for a PURE club_president. Someone who also holds an admin-tier
  // role gets canManage=true too, so canManage||isClubPresident below still
  // renders full controls for them rather than falling through to read-only.
  const isClubPresident = userRoles.includes("club_president");
  // Any staff position (secretary, finance, ... — src/lib/positions.ts, NOT
  // "president" since that's already club_president above) gets a read-only
  // view scoped to their own club(s): they can see this page and open the
  // Members modal, but never manage members, never see phone/contactChannels/
  // medical, and never export — the server mirrors this exactly (GET
  // /api/admin/clubs and .../[id]/members' staff-position tier; the
  // manage/medical/export routes are untouched and reject this tier).
  const isClubStaffViewer = !!session?.user?.hasClubPosition && !canManage && !isClubPresident;
  // "Include archived clubs" is a staff-triage control (dead/renamed clubs) —
  // irrelevant noise for a club_president, who only ever sees their own club(s)
  // anyway. Shown only to roles that actually manage the club roster at large.
  const canFilterArchived = userRoles.some((r) => ["admin", "super_admin", "smo"].includes(r));
  // Members-modal edit actions (add/remove a plain member) — staff can manage
  // any club, club_president only their own. The server independently
  // re-verifies club_president ownership on every request; this flag is UI-only.
  const canManageMembers = canManage || isClubPresident;

  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [clubQuery, setClubQuery] = useState("");

  // Create/rename modal. `editingId === "new"` means the create flow;
  // otherwise it holds the id of the club being renamed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Members modal — super_admin/admin only (gated at the API too, see
  // /api/admin/clubs/[id]/members). Each club's roster is only ever fetched
  // for the ONE club being viewed, on demand — never bulk-loaded for all clubs
  // at once, so opening this page never pulls every club's membership PII.
  const [viewingMembers, setViewingMembers] = useState<Club | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState("");
  // Which member's Medical & Emergency panel is expanded — one at a time, and
  // collapsed by default. Unlike the rest of the row, this data is NOT in
  // `members` — it's fetched (and audit-logged) per member, on first expand,
  // via GET .../members/[memberId]/medical, then cached here so re-toggling
  // the same member doesn't re-fetch/re-log. Keyed by userId.
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [medicalByUserId, setMedicalByUserId] = useState<Record<string, ClubMemberMedical>>({});
  const [loadingMedicalUserId, setLoadingMedicalUserId] = useState<string | null>(null);
  const [medicalError, setMedicalError] = useState<string | null>(null);

  // Add-member picker — canManageMembers only. Search is scoped to the club
  // currently open (GET /api/admin/clubs/[id]/members/search), NOT the full
  // student directory — a club_president has no legitimate reason to see every
  // student's house/role/major, so that broader endpoint stays staff-only.
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StudentOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  const loadMembers = (clubId: string) => {
    setMembersError(null);
    setLoadingMembers(true);
    fetch(`/api/admin/clubs/${clubId}/members`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error((data && data.error) || t.adminCmLoadMembersFailed);
        }
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setMembers(d); })
      .catch((err) => setMembersError(err instanceof Error ? err.message : t.adminCmLoadMembersFailed))
      .finally(() => setLoadingMembers(false));
  };

  // Export the currently-open club's roster as .xlsx. Built server-side at
  // /api/admin/clubs/[id]/members/export, which re-checks the same
  // canManageMembers gate and audit-logs the pull (PDPA bulk PII export) —
  // mirrors exportAttendanceXlsx on admin/events/page.tsx.
  const exportMembersXlsx = () => {
    if (!viewingMembers) return;
    const a = document.createElement("a");
    a.href = `/api/admin/clubs/${viewingMembers.id}/members/export`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openMembers = (club: Club) => {
    setViewingMembers(club);
    setMembers([]);
    setMemberSearch("");
    setSearchResults([]);
    setAddMemberError(null);
    setRosterFilter("");
    setExpandedMemberId(null);
    setMedicalByUserId({});
    setLoadingMedicalUserId(null);
    setMedicalError(null);
    loadMembers(club.id);
  };

  // Toggles a member's Medical & Emergency panel. On first expand (not yet
  // cached), fetches + audit-logs that ONE member's medical detail — see the
  // medicalByUserId state comment above. Re-collapsing/re-expanding the same
  // member afterward just reuses the cached result.
  const toggleMemberExpand = (m: ClubMember) => {
    const next = expandedMemberId === m.id ? null : m.id;
    setExpandedMemberId(next);
    if (!next || !viewingMembers || m.userId in medicalByUserId) return;
    setMedicalError(null);
    setLoadingMedicalUserId(m.userId);
    fetch(`/api/admin/clubs/${viewingMembers.id}/members/${m.userId}/medical`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error((data && data.error) || t.adminCmMedicalLoadFailed);
        }
        return r.json();
      })
      .then((data) => setMedicalByUserId((prev) => ({ ...prev, [m.userId]: data })))
      .catch((err) => setMedicalError(err instanceof Error ? err.message : t.adminCmMedicalLoadFailed))
      .finally(() => setLoadingMedicalUserId((id) => (id === m.userId ? null : id)));
  };

  // Debounced, club-scoped student search — only fires once the modal is open
  // and the caller may manage members, and only past a 2-char query (so it
  // never returns a "browse everyone" list, see the search route's own doc).
  useEffect(() => {
    if (!viewingMembers || !canManageMembers) return;
    const timer = setTimeout(() => {
      const q = memberSearch.trim();
      if (q.length < 2) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      fetch(`/api/admin/clubs/${viewingMembers.id}/members/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => { if (Array.isArray(d)) setSearchResults(d); })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [memberSearch, viewingMembers, canManageMembers]);

  const addMember = async (student: StudentOption) => {
    if (!viewingMembers) return;
    const userId = student.id;
    setAddingUserId(userId);
    setAddMemberError(null);
    try {
      const res = await fetch(`/api/admin/clubs/${viewingMembers.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || t.adminCmAddMemberFailed);
      }
      setMemberSearch("");
      setSearchResults([]);
      loadMembers(viewingMembers.id);
      refresh();
      toast.success(t.adminCmMemberAdded.replace("{name}", student.name).replace("{club}", viewingMembers.name));
    } catch (err) {
      setAddMemberError(err instanceof Error ? err.message : t.adminCmAddMemberFailed);
    } finally {
      setAddingUserId(null);
    }
  };

  const removeMember = async (m: ClubMember, displayName: string) => {
    if (!viewingMembers) return;
    const ok = await confirm({
      title: t.adminCmRemoveMemberTitle.replace("{name}", displayName).replace("{club}", viewingMembers.name),
      message: t.adminCmRemoveMemberBody,
      confirmLabel: t.adminCmRemoveMemberConfirm,
      tone: "danger",
    });
    if (!ok) return;
    const userId = m.userId;
    setRemovingUserId(userId);
    try {
      const res = await fetch(`/api/admin/clubs/${viewingMembers.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || t.adminCmRemoveMemberFailed);
      }
      loadMembers(viewingMembers.id);
      refresh();
      toast.success(t.adminCmMemberRemoved.replace("{name}", displayName));
    } catch (err) {
      toast.error(t.adminCmRemoveMemberFailed, err instanceof Error ? err.message : undefined);
    } finally {
      setRemovingUserId(null);
    }
  };

  const updateMemberPosition = async (userId: string, position: string | null) => {
    if (!viewingMembers) return;
    try {
      const res = await fetch(`/api/admin/clubs/${viewingMembers.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, position }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || t.adminCmPositionFailed);
      }
      loadMembers(viewingMembers.id);
      toast.success(t.adminCmPositionSaved);
    } catch (err) {
      toast.error(t.adminCmPositionFailed, err instanceof Error ? err.message : undefined);
    }
  };

  const refresh = () => {
    setLoading(true);
    setListError(null);
    fetch(`/api/admin/clubs?includeArchived=${includeArchived}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error((data && data.error) || t.adminCmLoadClubsFailed);
        }
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setClubs(d); })
      .catch((err) => setListError(err instanceof Error ? err.message : t.adminCmLoadClubsFailed))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Deferred via setTimeout so the fetch kicks off after this render commits,
    // matching the pattern used elsewhere (e.g. admin/students) — calling
    // setState synchronously inside the effect body itself is flagged by the
    // react-hooks/set-state-in-effect lint rule.
    const timer = setTimeout(() => {
      refresh();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeArchived]);

  const openCreate = () => {
    setEditingId("new");
    setNameDraft("");
    setFormError(null);
  };

  const openRename = (club: Club) => {
    setEditingId(club.id);
    setNameDraft(club.name);
    setFormError(null);
  };

  const closeModal = () => {
    if (saving) return;
    setEditingId(null);
    setNameDraft("");
    setFormError(null);
  };

  const submitModal = async () => {
    const name = nameDraft.trim();
    if (!name) {
      setFormError(t.adminCmNameRequired);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const isCreate = editingId === "new";
      const res = await fetch(isCreate ? "/api/admin/clubs" : `/api/admin/clubs/${editingId}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.error) || t.adminCmSaveClubFailed);
      }
      setEditingId(null);
      setNameDraft("");
      refresh();
      toast.success((isCreate ? t.adminCmClubCreated : t.adminCmClubRenamed).replace("{name}", name));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t.adminCmSaveClubFailed);
    } finally {
      setSaving(false);
    }
  };

  const toggleArchived = async (club: Club) => {
    setArchivingId(club.id);
    try {
      const res = await fetch(`/api/admin/clubs/${club.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: !club.isArchived }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || t.adminCmUpdateClubFailed);
      }
      refresh();
      toast.success((club.isArchived ? t.adminCmClubUnarchived : t.adminCmClubArchived).replace("{name}", club.name));
    } catch (err) {
      toast.error(t.adminCmUpdateClubFailed, err instanceof Error ? err.message : undefined);
    } finally {
      setArchivingId(null);
    }
  };

  // Permanent delete — super_admin/admin only, gated the same way server-side
  // (see DELETE /api/admin/clubs/[id]). The server also detaches this club's id
  // from any event's ownerClubIds before deleting it, so no event is left
  // pointing at a club that no longer exists.
  const askDelete = async (club: Club) => {
    const ok = await confirm({
      title: t.adminCmDeleteTitle.replace("{name}", club.name),
      message:
        club.memberCount > 0
          ? t.adminCmDeleteBodyWithMembers.replace("{n}", String(club.memberCount))
          : t.adminCmDeleteBody,
      confirmLabel: t.adminCmDeleteConfirm,
      tone: "danger",
    });
    if (!ok) return;
    setDeletingId(club.id);
    try {
      const res = await fetch(`/api/admin/clubs/${club.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || t.adminCmDeleteClubFailed);
      }
      refresh();
      toast.success(t.adminCmClubDeleted.replace("{name}", club.name));
    } catch (err) {
      toast.error(t.adminCmDeleteClubFailed, err instanceof Error ? err.message : undefined);
    } finally {
      setDeletingId(null);
    }
  };

  const memberCountText = (n: number) => (n === 1 ? t.adminCmMembersOne : t.adminCmMembersMany.replace("{n}", String(n)));
  const presidentCountText = (n: number) => (n === 1 ? t.adminCmPresidentsOne : t.adminCmPresidentsMany.replace("{n}", String(n)));

  const showActions = canManage || isClubPresident || isClubStaffViewer;

  const shownClubs = useMemo(() => {
    const q = clubQuery.trim().toLowerCase();
    return q ? clubs.filter((c) => c.name.toLowerCase().includes(q)) : clubs;
  }, [clubs, clubQuery]);

  const memberDisplayName = (m: ClubMember) => `${m.userName || t.adminCmUnnamed}${m.nickname ? ` (${m.nickname})` : ""}`;

  const shownMembers = useMemo(() => {
    const q = rosterFilter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => (m.userName || "").toLowerCase().includes(q) || (m.nickname || "").toLowerCase().includes(q) || (m.studentId || "").toLowerCase().includes(q),
    );
  }, [members, rosterFilter]);

  const rosterRows: RosterRow[] = shownMembers.map((m) => ({
    key: m.id,
    userId: m.userId,
    name: memberDisplayName(m),
    studentId: m.studentId,
    // Roster detail — the members GET route scopes this to super_admin/admin or
    // the club's own president (full shape, incl. phone/contactChannels) or, for
    // a non-president staff-position holder, a limited shape with
    // phone/contactChannels simply omitted (ClubsService.getClubMembers vs
    // getClubMembersLimited) — so every row reaching this client already carries
    // only what its viewer is authorized to see.
    meta: [m.major, m.house?.name ? canonicalHouseName(m.house) : null].filter((x): x is string => !!x),
    contacts: [m.phone, m.contactChannels].filter((x): x is string => !!x),
    isPresident: m.role === "president",
    position: m.position,
  }));

  // Medical & Emergency expand is gated to exactly the same set the server
  // allows into GET .../members/[memberId]/medical (admin/club_president —
  // canManageMembers happens to equal that set exactly). An isClubStaffViewer
  // never gets a toggle here, so they never fire a fetch the server would
  // reject anyway.
  const canExpandMedical = canManageMembers;

  const activeEditing = editingId !== null;
  const searchQuery = memberSearch.trim();

  return (
    <>
      <div className="animate-fade-in-up pb-24">
        <PageHeader
          title={t.manageClubs || "Clubs"}
          description={canManage ? t.adminCmClubsDescAdmin : t.adminCmClubsDescPresident}
          actions={
            canManage ? (
              <button className="btn btn-primary" onClick={openCreate}>
                <Plus size={18} aria-hidden="true" />
                {t.adminCmNewClub}
              </button>
            ) : undefined
          }
        />

        {isClubPresident && <EventFeedbackFormsShortcut clubs={clubs} scope="club" />}
        {isClubPresident && <ProposeEventSection scope={{ kind: "club", clubs }} />}

        {(canFilterArchived || clubs.length > CLUB_SEARCH_MIN) && (
          <Toolbar>
            {clubs.length > CLUB_SEARCH_MIN && (
              <div className="adm-search" style={{ position: "relative" }}>
                <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
                <input
                  className="input"
                  type="search"
                  aria-label={t.adminCmSearchClubs}
                  placeholder={t.adminCmSearchClubs}
                  value={clubQuery}
                  onChange={(e) => setClubQuery(e.target.value)}
                  style={{ paddingLeft: 40 }}
                />
              </div>
            )}
            {canFilterArchived && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer", fontSize: 14, color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  style={{ width: 20, height: 20, accentColor: "var(--accent-primary)" }}
                />
                {t.adminCmIncludeArchived}
              </label>
            )}
            {!loading && !listError && clubs.length > 0 && (
              <span role="status" style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: "auto" }}>
                {clubQuery.trim()
                  ? t.adminCmClubsShownOf.replace("{shown}", String(shownClubs.length)).replace("{total}", String(clubs.length))
                  : t.adminCmClubsCount.replace("{n}", String(clubs.length))}
              </span>
            )}
          </Toolbar>
        )}

        {/* List */}
        {listError ? (
          <ErrorState title={t.adminCmLoadClubsFailed} message={listError} onRetry={refresh} />
        ) : loading && clubs.length === 0 ? (
          <LoadingState variant="skeleton" rows={4} label={t.adminCmLoadingClubs} />
        ) : clubs.length === 0 ? (
          <EmptyState
            icon={<Building2 size={24} />}
            title={canManage ? t.adminCmNoClubsTitle : t.adminCmNoClubAssignedTitle}
            description={canManage ? t.adminCmNoClubsBody : t.adminCmNoClubAssignedBody}
            action={
              canManage ? (
                <button className="btn btn-primary" onClick={openCreate}>
                  <Plus size={18} aria-hidden="true" />
                  {t.adminCmNewClub}
                </button>
              ) : undefined
            }
          />
        ) : shownClubs.length === 0 ? (
          <EmptyState
            icon={<Search size={24} />}
            title={t.adminCmNoMatchTitle}
            description={t.adminCmNoMatchBody}
            action={<button className="btn btn-ghost" onClick={() => setClubQuery("")}>{t.adminCmClearSearch}</button>}
          />
        ) : (
          <>
            {/* Laptop / tablet */}
            <div className="hidden sm:block" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 20, overflow: "hidden" }}>
              <TableScroll label={t.manageClubs}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColName}</th>
                      <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColMembers}</th>
                      <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColStatus}</th>
                      <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColCreated}</th>
                      {showActions && <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12, textAlign: "right" }}>{t.adminCmColActions}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shownClubs.map((club) => {
                      const selected = viewingMembers?.id === club.id;
                      return (
                        <tr key={club.id} aria-current={selected ? "true" : undefined} style={selected ? { background: "var(--accent-glow)" } : undefined}>
                          <td style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Building2 size={16} aria-hidden="true" style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                              {club.name}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span>{memberCountText(club.memberCount)}</span>
                              {club.presidentCount > 0 && <StatusBadge tone="info" icon={false}>{presidentCountText(club.presidentCount)}</StatusBadge>}
                            </div>
                          </td>
                          <td>
                            {club.isArchived ? (
                              <StatusBadge tone="warning" icon={<Archive size={12} />}>{t.adminCmArchived}</StatusBadge>
                            ) : (
                              <StatusBadge tone="success">{t.adminCmActive}</StatusBadge>
                            )}
                          </td>
                          <td style={{ color: "var(--text-muted)" }}>{new Date(club.createdAt).toLocaleDateString()}</td>
                          {showActions && (
                            <td>
                              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                                <button className="btn btn-ghost btn-sm" onClick={() => openMembers(club)}>
                                  <Users size={14} aria-hidden="true" />
                                  {t.adminCmMembersButton}
                                </button>
                                {canManage && (
                                  <>
                                    <IconButton size="sm" label={t.adminCmRenameClubLabel.replace("{name}", club.name)} icon={<Pencil size={16} />} onClick={() => openRename(club)} />
                                    <IconButton
                                      size="sm"
                                      label={(club.isArchived ? t.adminCmUnarchiveClubLabel : t.adminCmArchiveClubLabel).replace("{name}", club.name)}
                                      icon={archivingId === club.id ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : club.isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                                      disabled={archivingId === club.id}
                                      onClick={() => toggleArchived(club)}
                                    />
                                    <span aria-hidden="true" style={{ width: 1, height: 24, background: "var(--border-subtle)", margin: "0 6px" }} />
                                    <IconButton
                                      size="sm"
                                      tone="danger"
                                      label={t.adminCmDeleteClubLabel.replace("{name}", club.name)}
                                      icon={deletingId === club.id ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Trash2 size={16} />}
                                      disabled={deletingId === club.id}
                                      onClick={() => askDelete(club)}
                                    />
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* Phones: cards */}
            <ul className="flex flex-col gap-2.5 sm:hidden" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shownClubs.map((club) => (
                <li key={club.id} style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <Building2 size={18} aria-hidden="true" style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{club.name}</span>
                    </div>
                    {club.isArchived ? (
                      <StatusBadge tone="warning" icon={<Archive size={12} />}>{t.adminCmArchived}</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">{t.adminCmActive}</StatusBadge>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                    <span>{memberCountText(club.memberCount)}</span>
                    {club.presidentCount > 0 && <span>{presidentCountText(club.presidentCount)}</span>}
                    <span style={{ color: "var(--text-muted)" }}>{t.adminCmColCreated}: {new Date(club.createdAt).toLocaleDateString()}</span>
                  </div>
                  {showActions && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btn-primary" onClick={() => openMembers(club)}>
                        <Users size={16} aria-hidden="true" />
                        {t.adminCmMembersButton}
                      </button>
                      {canManage && (
                        <>
                          <IconButton label={t.adminCmRenameClubLabel.replace("{name}", club.name)} icon={<Pencil size={18} />} onClick={() => openRename(club)} />
                          <IconButton
                            label={(club.isArchived ? t.adminCmUnarchiveClubLabel : t.adminCmArchiveClubLabel).replace("{name}", club.name)}
                            icon={archivingId === club.id ? <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : club.isArchived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                            disabled={archivingId === club.id}
                            onClick={() => toggleArchived(club)}
                          />
                          <span style={{ marginLeft: "auto" }}>
                            <IconButton
                              tone="danger"
                              label={t.adminCmDeleteClubLabel.replace("{name}", club.name)}
                              icon={deletingId === club.id ? <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <Trash2 size={18} />}
                              disabled={deletingId === club.id}
                              onClick={() => askDelete(club)}
                            />
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Create / Rename */}
      <Modal
        open={activeEditing}
        onClose={closeModal}
        size="sm"
        dismissible={!saving}
        icon={<Building2 size={20} />}
        title={editingId === "new" ? t.adminCmNewClub : t.adminCmRenameClub}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={saving}>
              {t.adminUiCancel}
            </button>
            <button type="submit" form="club-name-form" className="btn btn-primary" disabled={saving}>
              {saving ? t.adminCmSaving : editingId === "new" ? t.adminCmCreate : t.adminCmSave}
            </button>
          </>
        }
      >
        <form id="club-name-form" onSubmit={(e) => { e.preventDefault(); submitModal(); }}>
          <Field label={t.adminCmClubName} required hint={t.adminCmClubNameHint} error={formError}>
            {(p) => (
              <input
                {...p}
                className="input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={t.adminCmClubNamePlaceholder}
                autoComplete="off"
              />
            )}
          </Field>
        </form>
      </Modal>

      {/* Members modal — one club's roster at a time. super_admin/admin can open
          any club; a club_president can open only their own (the list API already
          scopes `clubs` to just their club(s), and the members API re-verifies
          server-side against club_members — see /api/admin/clubs/[id]/members —
          so a different club's president can never reach this via a crafted id).
          A non-president staff-position holder (isClubStaffViewer) can open only
          their own club too, but the members API returns a limited shape for them
          (no phone/contactChannels) and the medical/export/manage routes reject
          them outright regardless of what this client renders. */}
      <Modal
        open={!!viewingMembers}
        onClose={() => setViewingMembers(null)}
        size="xl"
        icon={<Building2 size={20} />}
        title={viewingMembers?.name ?? ""}
        description={t.adminCmRosterDesc.replace("{n}", String(members.length))}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setViewingMembers(null)}>
            {t.adminUiClose}
          </button>
        }
      >
        {viewingMembers && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Add-member picker — canManageMembers (staff, or club_president for
                their own club). Search is scoped server-side to THIS club (see
                GET .../members/search) — a club_president never gets the full
                student directory. Adds with role='member' only; granting
                'president' stays a Students-page action so the club_members row
                can never drift from the user's system role (see
                ClubsService.addClubMember). */}
            {canManageMembers && (
              <div>
                <Field label={t.adminCmAddMemberLabel} hint={t.adminCmAddMemberHint} error={addMemberError}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="search"
                      autoComplete="off"
                      placeholder={t.adminCmAddMemberPlaceholder}
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                    />
                  )}
                </Field>
                {searchQuery && (
                  <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                    {searching ? (
                      <LoadingState compact label={t.adminCmSearching} />
                    ) : (
                      (() => {
                        const results = searchResults.filter((s) => !members.some((m) => m.userId === s.id));
                        if (results.length === 0) {
                          return searchQuery.length < 2 ? null : (
                            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "6px 2px" }}>{t.adminCmNoStudentMatch}</p>
                          );
                        }
                        return results.map((s) => (
                          <div
                            key={s.id}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderRadius: 12, background: "var(--bg-elevated)" }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{s.name}</div>
                              {s.studentId && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.studentId}</div>}
                            </div>
                            <button className="btn btn-ghost btn-sm" disabled={addingUserId === s.id} onClick={() => addMember(s)} aria-label={t.adminCmAddNamed.replace("{name}", s.name)}>
                              {addingUserId === s.id ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Plus size={14} aria-hidden="true" />}
                              {t.adminCmAdd}
                            </button>
                          </div>
                        ));
                      })()
                    )}
                  </div>
                )}
              </div>
            )}

            {loadingMembers ? (
              <LoadingState variant="skeleton" rows={3} label={t.adminCmLoadingMembers} />
            ) : membersError ? (
              <ErrorState title={t.adminCmLoadMembersFailed} message={membersError} onRetry={() => loadMembers(viewingMembers.id)} compact />
            ) : members.length === 0 ? (
              <EmptyState
                icon={<Users size={24} />}
                compact
                title={t.adminCmNoMembersTitle}
                description={canManageMembers ? t.adminCmNoMembersManage : t.adminCmNoMembersView}
              />
            ) : (
              <div>
                {(members.length > ROSTER_FILTER_MIN || (canManageMembers && members.length > 0)) && (
                  <Toolbar>
                    {members.length > ROSTER_FILTER_MIN && (
                      <input
                        className="input"
                        type="search"
                        aria-label={t.adminCmFilterRoster}
                        placeholder={t.adminCmFilterRoster}
                        value={rosterFilter}
                        onChange={(e) => setRosterFilter(e.target.value)}
                      />
                    )}
                    <span role="status" style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      {rosterFilter.trim()
                        ? t.adminCmMembersShownOf.replace("{shown}", String(shownMembers.length)).replace("{total}", String(members.length))
                        : memberCountText(members.length)}
                    </span>
                    {canManageMembers && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginLeft: "auto" }}
                        onClick={exportMembersXlsx}
                        title={t.adminCmExportHint}
                      >
                        <Download size={14} aria-hidden="true" />
                        {t.adminCmExport}
                      </button>
                    )}
                  </Toolbar>
                )}
                {canManageMembers && (
                  <div style={{ marginBottom: 12 }}>
                    <InlineAlert tone="info">{t.adminCmExportHint}</InlineAlert>
                  </div>
                )}
                {shownMembers.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Search size={24} />}
                    title={t.adminCmNoMatchTitle}
                    description={t.adminCmNoMatchBody}
                    action={<button className="btn btn-ghost" onClick={() => setRosterFilter("")}>{t.adminCmClearSearch}</button>}
                  />
                ) : (
                  <RosterList
                    rows={rosterRows}
                    tableLabel={t.adminCmRosterTableLabel.replace("{club}", viewingMembers.name)}
                    editablePosition={canManageMembers}
                    onPositionChange={(row, position) => updateMemberPosition(row.userId, position)}
                    onRemove={
                      canManageMembers
                        ? (row) => {
                            const m = members.find((x) => x.id === row.key);
                            if (m) removeMember(m, row.name);
                          }
                        : undefined
                    }
                    removingUserId={removingUserId}
                    canExpandMedical={canExpandMedical}
                    expandedKey={expandedMemberId}
                    onToggleExpand={(row) => {
                      const m = members.find((x) => x.id === row.key);
                      if (m) toggleMemberExpand(m);
                    }}
                    renderMedical={(row) => (
                      // Collapsed by default, one member at a time. Fetched (and
                      // audit-logged as THIS member being viewed) on first expand,
                      // never bundled into the roster load — see toggleMemberExpand.
                      <MedicalDetailPanel
                        medical={medicalByUserId[row.userId]}
                        loading={loadingMedicalUserId === row.userId}
                        error={medicalError}
                      />
                    )}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
