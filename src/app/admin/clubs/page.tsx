"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/lib/LanguageContext";
import { effectiveRoles } from "@/lib/admin-access";
import { NON_SMO_POSITION_IDS, POSITION_I18N_KEY } from "@/lib/positions";
import { canonicalHouseName } from "@/lib/faculties";
import { ProposeEventSection } from "./ProposeEventSection";
import { EventFeedbackFormsShortcut } from "@/components/admin/EventFeedbackFormsShortcut";
import {
  Building2, Plus, Pencil, Archive, ArchiveRestore, X, Users, Eye,
  Trash2, AlertCircle, Check, Download, HeartPulse, ChevronDown, ChevronUp,
} from "lucide-react";

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
type ClubMemberMedical = {
  chronicDiseases: string | null;
  medicalHistory: string | null;
  drugAllergies: string | null;
  foodAllergies: string | null;
  dietaryRestrictions: string | null;
  faintingHistory: boolean | null;
  emergencyMedication: string | null;
  emergencyContacts: { relationship: string; phone: string }[];
};

type StudentOption = {
  id: string;
  name: string;
  studentId: string | null;
};

export default function ClubsPage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
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
  const canFilterArchived = userRoles.some((r) => ["admin", "super_admin", "smo", "registration"].includes(r));
  // Members-modal edit actions (add/remove a plain member) — staff can manage
  // any club, club_president only their own. The server independently
  // re-verifies club_president ownership on every request; this flag is UI-only.
  const canManageMembers = canManage || isClubPresident;

  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  // Create/rename modal. `editingId === "new"` means the create flow;
  // otherwise it holds the id of the club being renamed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Club | null>(null);

  // Members modal — super_admin/admin only (gated at the API too, see
  // /api/admin/clubs/[id]/members). Each club's roster is only ever fetched
  // for the ONE club being viewed, on demand — never bulk-loaded for all clubs
  // at once, so opening this page never pulls every club's membership PII.
  const [viewingMembers, setViewingMembers] = useState<Club | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
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
          throw new Error((data && data.error) || "Failed to load members");
        }
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setMembers(d); })
      .catch((err) => setMembersError(err instanceof Error ? err.message : "Failed to load members"))
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
          throw new Error((data && data.error) || "Failed to load medical detail");
        }
        return r.json();
      })
      .then((data) => setMedicalByUserId((prev) => ({ ...prev, [m.userId]: data })))
      .catch((err) => setMedicalError(err instanceof Error ? err.message : "Failed to load medical detail"))
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

  const addMember = async (userId: string) => {
    if (!viewingMembers) return;
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
        throw new Error((data && data.error) || "Failed to add member");
      }
      setMemberSearch("");
      setSearchResults([]);
      loadMembers(viewingMembers.id);
      refresh();
    } catch (err) {
      setAddMemberError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAddingUserId(null);
    }
  };

  const removeMember = async (userId: string) => {
    if (!viewingMembers) return;
    setRemovingUserId(userId);
    try {
      const res = await fetch(`/api/admin/clubs/${viewingMembers.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || "Failed to remove member");
      }
      loadMembers(viewingMembers.id);
      refresh();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingUserId(null);
    }
  };

  const updateMemberPosition = async (userId: string, position: string | null) => {
    if (!viewingMembers) return;
    setMembersError(null);
    try {
      const res = await fetch(`/api/admin/clubs/${viewingMembers.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, position }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || "Failed to update position");
      }
      loadMembers(viewingMembers.id);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Failed to update position");
    }
  };

  const refresh = () => {
    setLoading(true);
    setListError(null);
    fetch(`/api/admin/clubs?includeArchived=${includeArchived}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error((data && data.error) || "Failed to load clubs");
        }
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setClubs(d); })
      .catch((err) => setListError(err instanceof Error ? err.message : "Failed to load clubs"))
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
      setFormError("Name is required");
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
        throw new Error((data && data.error) || "Failed to save club");
      }
      setEditingId(null);
      setNameDraft("");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save club");
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
        throw new Error((data && data.error) || "Failed to update club");
      }
      refresh();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to update club");
    } finally {
      setArchivingId(null);
    }
  };

  // Permanent delete — super_admin/admin only, gated the same way server-side
  // (see DELETE /api/admin/clubs/[id]). The server also detaches this club's id
  // from any event's ownerClubIds before deleting it, so no event is left
  // pointing at a club that no longer exists.
  const confirmAndDelete = async () => {
    if (!confirmDelete) return;
    const club = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(club.id);
    try {
      const res = await fetch(`/api/admin/clubs/${club.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || "Failed to delete club");
      }
      refresh();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete club");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="animate-fade-in-up pb-24">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6" style={{ marginBottom: 40 }}>
          <h1 className="text-[clamp(32px,5vw,48px)] font-black tracking-tighter text-[var(--text-primary)] leading-tight">
            {t.manageClubs || "Clubs"}
          </h1>
          {canManage && (
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={18} />
              New Club
            </button>
          )}
        </div>

        {/* Controls */}
        {canFilterArchived && (
          <div
            className="bg-[var(--bg-surface)] p-4 rounded-[32px] border border-[var(--border-subtle)] shadow-2xl shadow-black/5"
            style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}
          >
            <div
              role="checkbox"
              aria-checked={includeArchived}
              tabIndex={0}
              onClick={() => setIncludeArchived((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIncludeArchived((v) => !v);
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                borderRadius: 12,
                cursor: "pointer",
                userSelect: "none",
                transition: "all 0.2s",
                background: includeArchived ? "var(--bg-elevated)" : "transparent",
                border: `1px solid ${includeArchived ? "var(--accent-primary)" : "var(--border-subtle)"}`,
              }}
            >
              <div style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                background: includeArchived ? "var(--accent-primary)" : "transparent",
                border: `2px solid ${includeArchived ? "var(--accent-primary)" : "var(--border-medium)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s",
              }}>
                {includeArchived && <Check size={13} color="white" strokeWidth={3} />}
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: includeArchived ? "var(--text-primary)" : "var(--text-secondary)" }}>
                Include archived clubs
              </span>
            </div>
          </div>
        )}

        {isClubPresident && <EventFeedbackFormsShortcut clubs={clubs} scope="club" />}
        {isClubPresident && <ProposeEventSection clubs={clubs} />}

        {listError && (
          <div
            style={{
              padding: "16px 20px",
              borderRadius: 16,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: "#ef4444",
              fontWeight: 600,
              marginBottom: 24,
            }}
          >
            {listError}
          </div>
        )}

        {/* Table */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 40,
            overflow: "hidden",
            boxShadow: "0 20px 50px rgba(0,0,0,0.02)",
          }}
        >
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 100, gap: 20 }}>
              <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
              <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>Loading clubs…</p>
            </div>
          ) : clubs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 100, gap: 16 }}>
              <Building2 size={40} style={{ color: "var(--text-muted)" }} />
              <p style={{ color: "var(--text-muted)", fontWeight: 600 }}>
                {canManage ? "No clubs yet." : "You don't have a club assigned yet — contact an admin."}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ borderCollapse: "separate", borderSpacing: "0 0" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "24px 32px" }}>Name</th>
                    <th>Members</th>
                    <th>Status</th>
                    <th>Created</th>
                    {(canManage || isClubPresident || isClubStaffViewer) && <th style={{ textAlign: "right", paddingRight: 32 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {clubs.map((club) => (
                    <tr key={club.id}>
                      <td style={{ padding: "16px 32px", fontWeight: 700, color: "var(--text-primary)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Building2 size={16} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                          {club.name}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontWeight: 600 }}>
                          <Users size={14} style={{ color: "var(--text-muted)" }} />
                          {club.memberCount} member{club.memberCount === 1 ? "" : "s"}
                          {club.presidentCount > 0 && (
                            <span className="badge badge-blue" style={{ marginLeft: 6 }}>
                              {club.presidentCount} president{club.presidentCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {club.isArchived ? (
                          <span className="badge badge-yellow">Archived</span>
                        ) : (
                          <span className="badge badge-green">Active</span>
                        )}
                      </td>
                      <td style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                        {new Date(club.createdAt).toLocaleDateString()}
                      </td>
                      {(canManage || isClubPresident || isClubStaffViewer) && (
                        <td style={{ textAlign: "right", paddingRight: 32 }}>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => openMembers(club)}>
                              <Eye size={14} />
                              Members
                            </button>
                            {canManage && (
                              <>
                                <button className="btn btn-ghost btn-sm" onClick={() => openRename(club)}>
                                  <Pencil size={14} />
                                  Rename
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  disabled={archivingId === club.id}
                                  onClick={() => toggleArchived(club)}
                                >
                                  {club.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                                  {club.isArchived ? "Unarchive" : "Archive"}
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  style={{ color: "#ef4444" }}
                                  disabled={deletingId === club.id}
                                  onClick={() => setConfirmDelete(club)}
                                >
                                  {deletingId === club.id ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Trash2 size={14} />}
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create / Rename Modal */}
      {editingId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "clamp(12px, 4vw, 24px)",
          }}
          onClick={closeModal}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "100%",
              maxWidth: 440,
              borderRadius: "clamp(20px, 5vw, 32px)",
              overflow: "hidden",
              boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <div style={{ padding: "28px 32px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>
                {editingId === "new" ? "New Club" : "Rename Club"}
              </h2>
              <button className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label className="label">Club Name</label>
                <input
                  className="input"
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitModal(); }}
                  placeholder="e.g. Coding Club"
                />
              </div>
              {formError && (
                <p style={{ color: "#ef4444", fontWeight: 600, fontSize: 13 }}>{formError}</p>
              )}
            </div>

            <div style={{ padding: "20px 32px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button className="btn btn-ghost" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitModal} disabled={saving}>
                {saving ? "Saving…" : editingId === "new" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal — one club's roster at a time. super_admin/admin can open
          any club; a club_president can open only their own (the list API already
          scopes `clubs` to just their club(s), and the members API re-verifies
          server-side against club_members — see /api/admin/clubs/[id]/members —
          so a different club's president can never reach this via a crafted id).
          A non-president staff-position holder (isClubStaffViewer) can open only
          their own club too, but the members API returns a limited shape for them
          (no phone/contactChannels) and the medical/export/manage routes reject
          them outright regardless of what this client renders. */}
      {viewingMembers && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "clamp(12px, 4vw, 24px)",
          }}
          onClick={() => setViewingMembers(null)}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "100%",
              maxWidth: 480,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: "clamp(20px, 5vw, 32px)",
              overflow: "hidden",
              boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <div style={{ padding: "28px 32px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>
                  {viewingMembers.name}
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>
                  {members.length} member{members.length === 1 ? "" : "s"}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {canManageMembers && members.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={exportMembersXlsx}
                    title="Export the full roster (identity, contact, house, position, medical & emergency contact) to Excel (.xlsx) — this export is audit-logged"
                  >
                    <Download size={14} />
                    Export
                  </button>
                )}
                <button className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }} onClick={() => setViewingMembers(null)}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Add-member picker — canManageMembers (staff, or club_president for
                their own club). Search is scoped server-side to THIS club (see
                GET .../members/search) — a club_president never gets the full
                student directory. Adds with role='member' only; granting
                'president' stays a Students-page action so the club_members row
                can never drift from the user's system role (see
                ClubsService.addClubMember). */}
            {canManageMembers && (
              <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
                <input
                  className="input"
                  placeholder="Search students by name or student ID to add…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
                {memberSearch.trim() && (
                  <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {searching ? (
                      <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                        <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      </div>
                    ) : (
                      searchResults
                        .filter((s) => !members.some((m) => m.userId === s.id))
                        .map((s) => (
                          <div
                            key={s.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 10px",
                              borderRadius: 10,
                              background: "var(--bg-elevated)",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{s.name}</div>
                              {s.studentId && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.studentId}</div>}
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={addingUserId === s.id}
                              onClick={() => addMember(s.id)}
                            >
                              {addingUserId === s.id ? <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : <Plus size={12} />}
                              Add
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                )}
                {addMemberError && (
                  <p style={{ color: "#ef4444", fontWeight: 600, fontSize: 12, marginTop: 6 }}>{addMemberError}</p>
                )}
              </div>
            )}

            <div style={{ padding: "12px 20px", overflowY: "auto", flex: 1 }}>
              {loadingMembers ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                  <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                </div>
              ) : membersError ? (
                <p style={{ color: "#ef4444", fontWeight: 600, fontSize: 13, padding: "12px 12px" }}>{membersError}</p>
              ) : members.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontWeight: 600, fontSize: 13, padding: "12px 12px" }}>
                  {canManageMembers
                    ? "No members yet — search above to add one, or assign a club_president from the Students page."
                    : "No members yet — assign a club_president to this club from the Students page."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {members.map((m) => {
                    const isExpanded = expandedMemberId === m.id;
                    const medical = medicalByUserId[m.userId];
                    const isLoadingMedical = loadingMedicalUserId === m.userId;
                    const hasMedicalDetail = !!(
                      medical && (medical.chronicDiseases || medical.medicalHistory || medical.drugAllergies || medical.foodAllergies ||
                      medical.dietaryRestrictions || medical.faintingHistory || medical.emergencyMedication || medical.emergencyContacts.length > 0)
                    );
                    // Medical & Emergency expand is gated to exactly the same set the
                    // server allows into GET .../members/[memberId]/medical
                    // (admin/club_president — canManageMembers happens to equal that
                    // set exactly). An isClubStaffViewer never gets a clickable
                    // chevron here, so they never fire a fetch the server would
                    // reject anyway.
                    const canExpandMedical = canManageMembers;
                    return (
                    <div key={m.id} style={{ borderRadius: 12, background: "var(--bg-elevated)", overflow: "hidden" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "10px 12px",
                          cursor: canExpandMedical ? "pointer" : "default",
                        }}
                        onClick={canExpandMedical ? () => toggleMemberExpand(m) : undefined}
                      >
                        <div style={{ minWidth: 0, display: "flex", alignItems: "flex-start", gap: 6 }}>
                          {canExpandMedical && (isExpanded ? <ChevronUp size={14} style={{ marginTop: 3, flexShrink: 0, color: "var(--text-muted)" }} /> : <ChevronDown size={14} style={{ marginTop: 3, flexShrink: 0, color: "var(--text-muted)" }} />)}
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>
                              {m.userName || "Unnamed"}{m.nickname ? ` (${m.nickname})` : ""}
                            </div>
                            {m.studentId && (
                              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                                {m.studentId}
                              </div>
                            )}
                            {/* Roster detail — the members GET route scopes this to
                                super_admin/admin or the club's own president (full
                                shape, incl. phone/contactChannels) or, for a
                                non-president staff-position holder, a limited shape
                                with phone/contactChannels simply omitted (see
                                ClubsService.getClubMembers vs getClubMembersLimited) —
                                so every row reaching this client already carries only
                                what its viewer is authorized to see. */}
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {m.major && <span>{m.major}</span>}
                              {m.house?.name && <span>{canonicalHouseName(m.house)}</span>}
                              {m.phone && <span>{m.phone}</span>}
                              {m.contactChannels && <span>{m.contactChannels}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          {m.role === "president" ? (
                            // Locked: a club president's position is always "President"
                            // (ClubsService.setMemberPosition/applyClubPresidencies keep
                            // that club_members row's position in sync server-side) — no
                            // editable control is ever rendered here, for anyone,
                            // including super_admin.
                            <span className="badge badge-blue">President</span>
                          ) : canManageMembers ? (
                            <select
                              className="input"
                              style={{ width: 160, fontSize: 12, padding: "4px 8px" }}
                              value={m.position || ""}
                              onChange={(e) => updateMemberPosition(m.userId, e.target.value || null)}
                            >
                              <option value="">—</option>
                              {NON_SMO_POSITION_IDS.map((id) => (
                                <option key={id} value={id}>{t[POSITION_I18N_KEY[id] as keyof typeof t]}</option>
                              ))}
                            </select>
                          ) : (
                            m.position && (
                              <span className="badge">{t[POSITION_I18N_KEY[m.position as keyof typeof POSITION_I18N_KEY] as keyof typeof t]}</span>
                            )
                          )}
                          {canManageMembers && m.role !== "president" && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: "#ef4444", padding: "4px 8px" }}
                              disabled={removingUserId === m.userId}
                              onClick={() => removeMember(m.userId)}
                              title="Remove from club"
                            >
                              {removingUserId === m.userId ? <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : <X size={14} />}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Medical & Emergency — collapsed by default, one member at a
                          time. Unlike the rest of the row, this data is fetched (and
                          audit-logged as THIS member being viewed) on first expand, not
                          bundled into the roster load — see toggleMemberExpand. Emergency
                          contacts are pre-redacted server-side to relationship + phone
                          only (no contact name). */}
                      {isExpanded && (
                        <div style={{ padding: "0 12px 12px 32px", borderTop: "1px solid var(--border-subtle)", marginTop: 0, paddingTop: 10 }}>
                          {isLoadingMedical ? (
                            <div style={{ display: "flex", justifyContent: "center", padding: 10 }}>
                              <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                            </div>
                          ) : !medical ? (
                            <p style={{ fontSize: 12, color: "#ef4444" }}>{medicalError || "Failed to load medical detail."}</p>
                          ) : !hasMedicalDetail ? (
                            <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>No medical info on file.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                                <HeartPulse size={13} /> Medical & Emergency
                              </div>
                              {medical.chronicDiseases && <p style={{ fontSize: 12 }}><b>Chronic:</b> {medical.chronicDiseases}</p>}
                              {medical.medicalHistory && <p style={{ fontSize: 12 }}><b>History:</b> {medical.medicalHistory}</p>}
                              {medical.drugAllergies && <p style={{ fontSize: 12, color: "#ef4444" }}><b>Drug allergies:</b> {medical.drugAllergies}</p>}
                              {medical.foodAllergies && <p style={{ fontSize: 12, color: "#ef4444" }}><b>Food allergies:</b> {medical.foodAllergies}</p>}
                              {medical.dietaryRestrictions && <p style={{ fontSize: 12 }}><b>Dietary:</b> {medical.dietaryRestrictions}</p>}
                              {medical.faintingHistory && <p style={{ fontSize: 12, color: "#ef4444" }}>History of fainting</p>}
                              {medical.emergencyMedication && <p style={{ fontSize: 12, color: "#ef4444" }}><b>Emergency medication:</b> {medical.emergencyMedication}</p>}
                              {medical.emergencyContacts.length > 0 && (
                                <p style={{ fontSize: 12 }}>
                                  <b>Emergency contact:</b>{" "}
                                  {medical.emergencyContacts.map((c, i) => (
                                    <span key={i}>{i > 0 ? "; " : ""}{c.relationship}: {c.phone}</span>
                                  ))}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — danger style, matches admin/events. Permanent:
          the club and all its club_members rows are gone; any event still
          citing it as an owner is detached server-side (see DELETE route). */}
      {confirmDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)",
            zIndex: 2400,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-surface)",
              width: "90%",
              maxWidth: 440,
              borderRadius: 28,
              padding: 32,
              textAlign: "center",
              boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}>
              <AlertCircle size={28} />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", marginBottom: 12 }}>
              Delete &ldquo;{confirmDelete.name}&rdquo;?
            </h4>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 28 }}>
              This permanently removes the club{confirmDelete.memberCount > 0 ? ` and its ${confirmDelete.memberCount} member${confirmDelete.memberCount === 1 ? "" : "s"}` : ""}.
              Any event that had this club assigned as an owner will need a new club assigned. This cannot be undone — consider Archive instead if you just want to hide it.
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 700 }}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="btn"
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 800,
                  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  color: "#fff",
                  border: "none",
                  boxShadow: "0 4px 14px rgba(239, 68, 68, 0.3)",
                }}
                onClick={confirmAndDelete}
              >
                Delete Club
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
