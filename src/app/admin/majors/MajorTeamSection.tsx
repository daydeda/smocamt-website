"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { NON_SMO_POSITION_IDS, POSITION_I18N_KEY } from "@/lib/access/positions";
import { canonicalHouseName } from "@/lib/profile/faculties";
import { EmptyState, ErrorState, Field, InlineAlert, LoadingState, Panel, useToast } from "@/components/admin/ui";
import { MedicalDetailPanel, type MemberMedical } from "../_roster/MedicalDetailPanel";
import { RosterList, type RosterRow } from "../_roster/RosterList";
import { Download, Plus, Users } from "lucide-react";

type MajorTeamMember = {
  id: string;
  name: string | null;
  nickname: string | null;
  studentId: string | null;
  phone: string | null;
  contactChannels: string | null;
  house: { id: string; name: string; color: string | null } | null;
  position: string | null;
  // This row IS the major's president (roles includes major_president) — see
  // MajorsService.getMajorMembers. Locks the position control to "President".
  isPresident: boolean;
};

// Medical/emergency-contact detail for ONE student — fetched on demand from
// GET .../members/[memberId]/medical (never bundled into the roster fetch
// above) only when that student's panel is expanded, and audit-logged as
// that specific student being viewed (see MajorsService.getMajorMemberMedical).
// Emergency contacts are pre-redacted server-side to relationship + phone
// only (no contact name).
type MajorTeamMemberMedical = MemberMedical;

// major_president-only "Team" panel — the major analogue of admin/clubs's
// Members modal. Majors have no roster table to add/remove from (membership
// is just users.major, see MajorsService) — GET already returns EVERY student
// in the major, which could be the whole cohort. So "the team" here is
// defined client-side as whoever already carries a position (or is the
// president): the roster below only ever shows that subset, and "adding" a
// team member means picking one of the REMAINING major students (via the
// search box, filtered from the same already major-scoped `members` array —
// never a separate broader endpoint) and assigning them a position, which is
// the same PATCH used to edit an existing team member's position. GET/PATCH
// are scoped server-side to the signed-in president's own major (see
// api/admin/majors/[code]/members/route.ts).
export function MajorTeamSection({ major }: { major: string }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [members, setMembers] = useState<MajorTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Add-to-team search — filters the already major-scoped `members` array
  // client-side (no separate search endpoint, so there's no way to leak a
  // student outside this major into the results). Only candidates without a
  // position yet (not already on the team) are offered.
  const [addSearch, setAddSearch] = useState("");
  // Draft position picked for each add-candidate row, keyed by user id, so
  // switching the dropdown on one search result doesn't affect the others.
  const [addPositionDraft, setAddPositionDraft] = useState<Record<string, string>>({});
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  // Which member's Medical & Emergency panel is expanded — one at a time,
  // collapsed by default. Unlike the rest of the row, this data is NOT in
  // `members` — it's fetched (and audit-logged) per student, on first
  // expand, via GET .../members/[memberId]/medical, then cached here so
  // re-toggling the same student doesn't re-fetch/re-log. Keyed by user id
  // (== m.id for majors — see MajorsService.getMajorMembers).
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [medicalById, setMedicalById] = useState<Record<string, MajorTeamMemberMedical>>({});
  const [loadingMedicalId, setLoadingMedicalId] = useState<string | null>(null);
  const [medicalError, setMedicalError] = useState<string | null>(null);

  const loadMembers = () => {
    setError(null);
    setLoading(true);
    fetch(`/api/admin/majors/${major}/members`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error((data && data.error) || t.adminCmLoadTeamFailed);
        }
        return r.json();
      })
      .then((data) => setMembers(data))
      .catch((err) => setError(err instanceof Error ? err.message : t.adminCmLoadTeamFailed))
      .finally(() => setLoading(false));
  };

  // Toggles a student's Medical & Emergency panel. On first expand (not yet
  // cached), fetches + audit-logs that ONE student's medical detail.
  // Re-collapsing/re-expanding afterward just reuses the cached result.
  const toggleMemberExpand = (m: MajorTeamMember) => {
    const next = expandedMemberId === m.id ? null : m.id;
    setExpandedMemberId(next);
    if (!next || m.id in medicalById) return;
    setMedicalError(null);
    setLoadingMedicalId(m.id);
    fetch(`/api/admin/majors/${major}/members/${m.id}/medical`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error((data && data.error) || t.adminCmMedicalLoadFailed);
        }
        return r.json();
      })
      .then((data) => setMedicalById((prev) => ({ ...prev, [m.id]: data })))
      .catch((err) => setMedicalError(err instanceof Error ? err.message : t.adminCmMedicalLoadFailed))
      .finally(() => setLoadingMedicalId((id) => (id === m.id ? null : id)));
  };

  useEffect(() => {
    // Deferred via setTimeout so the setState calls in loadMembers fire after
    // this render commits, not synchronously within the effect — mirrors the
    // pattern in admin/majors/page.tsx (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      setExpandedMemberId(null);
      setMedicalById({});
      setLoadingMedicalId(null);
      setMedicalError(null);
      setAddSearch("");
      setAddPositionDraft({});
      loadMembers();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [major]);

  // Export the major's roster as .xlsx. Built server-side at
  // /api/admin/majors/[code]/members/export, which re-checks the same scope
  // gate and audit-logs the pull (PDPA bulk PII export) — mirrors
  // exportAttendanceXlsx on admin/events/page.tsx.
  const exportMembersXlsx = () => {
    const a = document.createElement("a");
    a.href = `/api/admin/majors/${major}/members/export`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const updatePosition = async (userId: string, position: string | null): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/majors/${major}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, position }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || t.adminCmPositionFailed);
      }
      loadMembers();
      toast.success(t.adminCmPositionSaved);
      return true;
    } catch (err) {
      toast.error(t.adminCmPositionFailed, err instanceof Error ? err.message : undefined);
      return false;
    }
  };

  // "The team" = major students who already carry a position (or are the
  // president) — everyone else in the major stays out of this list until
  // explicitly added below.
  const teamMembers = useMemo(
    () => members.filter((m) => m.isPresident || !!m.position),
    [members]
  );

  // Add-to-team candidates — filtered from the SAME major-scoped `members`
  // array, so results can never include a student outside this major. Only
  // students not already on the team are offered, and only once the
  // president has typed something (never a "browse everyone" list).
  const addQuery = addSearch.trim().toLowerCase();
  const addCandidates = useMemo(() => {
    if (!addQuery) return [];
    return members
      .filter((m) => !m.isPresident && !m.position)
      .filter((m) =>
        (m.name || "").toLowerCase().includes(addQuery) ||
        (m.nickname || "").toLowerCase().includes(addQuery) ||
        (m.studentId || "").toLowerCase().includes(addQuery)
      )
      .slice(0, 20);
  }, [members, addQuery]);

  // Adding a team member IS assigning them a position — there's no separate
  // roster row to create (see the component-level comment above), so this
  // just reuses updatePosition and then clears the search.
  const addTeamMember = async (userId: string, position: string) => {
    setAddingUserId(userId);
    try {
      const ok = await updatePosition(userId, position);
      if (ok) {
        setAddSearch("");
        setAddPositionDraft((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    } finally {
      setAddingUserId(null);
    }
  };

  const displayName = (m: MajorTeamMember) => `${m.name || t.adminCmUnnamed}${m.nickname ? ` (${m.nickname})` : ""}`;

  const rosterRows: RosterRow[] = teamMembers.map((m) => ({
    key: m.id,
    userId: m.id,
    name: displayName(m),
    studentId: m.studentId,
    // Full roster detail — the members GET route already scopes this to
    // super_admin/admin or the major's own president, so every row reaching
    // this client is already authorized to see it (MajorsService.getMajorMembers).
    meta: m.house?.name ? [canonicalHouseName(m.house)] : [],
    contacts: [m.phone, m.contactChannels].filter((x): x is string => !!x),
    isPresident: m.isPresident,
    position: m.position,
  }));

  return (
    <div style={{ marginBottom: 24 }}>
      <Panel
        title={t.myTeam || "My Team"}
        icon={<Users size={20} />}
        description={t.adminCmTeamDesc}
        actions={
          members.length > 0 ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={exportMembersXlsx}
              title={t.adminCmExportHint}
            >
              <Download size={14} aria-hidden="true" />
              {t.adminCmExport}
            </button>
          ) : undefined
        }
      >
        {loading ? (
          <LoadingState compact label={t.adminCmLoadingTeam} />
        ) : error ? (
          <ErrorState compact title={t.adminCmLoadTeamFailed} message={error} onRetry={loadMembers} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Add-to-team search — scoped to `members`, which is already this
                president's own major only (see the component-level comment).
                Only students without a position yet are offered as candidates. */}
            <div>
              <Field label={t.adminCmAddTeamLabel} hint={t.adminCmAddTeamHint}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    type="search"
                    autoComplete="off"
                    placeholder={t.addTeamMemberSearchPlaceholder || "Search your major's students by name, nickname, or student ID to add…"}
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                  />
                )}
              </Field>
              {addQuery && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {addCandidates.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "4px 2px" }}>
                      {t.addTeamMemberNoResults || "No matching students found in your major."}
                    </p>
                  ) : (
                    addCandidates.map((c) => {
                      const draft = addPositionDraft[c.id] || "";
                      return (
                        <div
                          key={c.id}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12, background: "var(--bg-elevated)" }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{displayName(c)}</div>
                            {c.studentId && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.studentId}</div>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <select
                              className="input"
                              aria-label={t.adminCmPositionFor.replace("{name}", displayName(c))}
                              style={{ width: 180, fontSize: 13 }}
                              value={draft}
                              onChange={(e) => setAddPositionDraft((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            >
                              <option value="">{t.adminCmPickPosition}</option>
                              {NON_SMO_POSITION_IDS.map((id) => (
                                <option key={id} value={id}>{t[POSITION_I18N_KEY[id] as keyof typeof t]}</option>
                              ))}
                            </select>
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={!draft || addingUserId === c.id}
                              onClick={() => addTeamMember(c.id, draft)}
                              aria-label={t.adminCmAddNamed.replace("{name}", displayName(c))}
                            >
                              {addingUserId === c.id ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Plus size={14} aria-hidden="true" />}
                              {t.adminCmAdd}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {teamMembers.length === 0 ? (
              <EmptyState
                compact
                icon={<Users size={24} />}
                title={members.length === 0 ? t.adminCmNoStudentsTitle : t.adminCmNoTeamTitle}
                description={members.length === 0 ? t.adminCmNoStudentsBody : t.adminCmNoTeamBody}
              />
            ) : (
              <div>
                <p role="status" style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
                  {teamMembers.length === 1 ? t.adminCmTeamCountOne : t.adminCmTeamCountMany.replace("{n}", String(teamMembers.length))}
                </p>
                <div style={{ marginBottom: 12 }}>
                  <InlineAlert tone="info">{t.adminCmExportHint}</InlineAlert>
                </div>
                <RosterList
                  rows={rosterRows}
                  tableLabel={t.adminCmTeamTableLabel}
                  editablePosition
                  onPositionChange={(row, position) => { void updatePosition(row.userId, position); }}
                  canExpandMedical
                  expandedKey={expandedMemberId}
                  onToggleExpand={(row) => {
                    const m = members.find((x) => x.id === row.key);
                    if (m) toggleMemberExpand(m);
                  }}
                  renderMedical={(row) => (
                    // Collapsed by default, one member at a time. Fetched (and
                    // audit-logged as THIS student being viewed) on first expand,
                    // not bundled into the roster load — see toggleMemberExpand.
                    <MedicalDetailPanel
                      medical={medicalById[row.userId]}
                      loading={loadingMedicalId === row.userId}
                      error={medicalError}
                    />
                  )}
                />
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
