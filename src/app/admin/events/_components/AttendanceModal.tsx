"use client";

import { Activity, AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Download, GraduationCap, HeartPulse, ShieldCheck, User, UserX, Users, Zap } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import { EmptyState, ErrorState, LoadingState, Modal, StatCard, type Tone } from "@/components/admin/ui";
import type { AdminEventsPageCtx, AttendanceUnit } from "../_lib/useAdminEventsPage";
import { AttendanceCard } from "./AttendanceCard";
import { FilterChip } from "./FilterChip";
import { fmt } from "./fmt";

const TILE_UI: Record<string, { tone: Tone; icon: React.ReactNode }> = {
  checkedIn: { tone: "success", icon: <CheckCircle2 size={18} /> },
  preReg: { tone: "accent", icon: <Users size={18} /> },
  walkIn: { tone: "info", icon: <Zap size={18} /> },
  noShow: { tone: "danger", icon: <UserX size={18} /> },
};

export function AttendanceModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { activeEvent, activeEventId, activeEventSessions, attendance, attendanceError, attendanceSummaryTiles, attendanceUnits, canSeeAttendeeContactAndMedical, canSeeRawMedicalDetail, checkInCount, exportAttendanceXlsx, filterEventNoShow, filterInternational, filterMaster, filterMedical, filterNotCheckedIn, filterPhd, filterStrikeHistory, filterStudentsOnly, filterThai, filteredAttendance, groupedAttendance, isMultiDayEvent, loadingAttendance, openStrikesModal, registeredCount, selectedSessionId, setFilterEventNoShow, setFilterInternational, setFilterMaster, setFilterMedical, setFilterNotCheckedIn, setFilterPhd, setFilterStrikeHistory, setFilterStudentsOnly, setFilterThai, setSelectedSessionId, setShowAttendance, setYearFilter, showAttendance, showExportButton, showStrikeButton, t, tallyUnits, viewAttendance, yearFilter } = ctx;

  const moreFiltersOn = [filterStudentsOnly, filterMaster, filterPhd, !filterThai, !filterInternational, yearFilter.size > 0].filter(Boolean).length;
  const filtersOn = filterMedical || filterNotCheckedIn || filterStrikeHistory || filterEventNoShow || moreFiltersOn > 0;
  const anyFilter = filtersOn || !!selectedSessionId;

  const clearFilters = () => {
    setFilterMedical(false);
    setFilterNotCheckedIn(false);
    setFilterStrikeHistory(false);
    setFilterEventNoShow(false);
    setFilterStudentsOnly(false);
    setFilterMaster(false);
    setFilterPhd(false);
    setFilterThai(true);
    setFilterInternational(true);
    setYearFilter(new Set());
  };

  const close = () => setShowAttendance(false);
  const hasRoster = attendance.length > 0 || groupedAttendance.staff.length > 0;
  const nothingMatches = filteredAttendance.length === 0 && groupedAttendance.staff.length === 0;

  const dayOptions: { id: string | null; label: string }[] = [
    { id: null, label: t.adminEvlAllDays },
    ...activeEventSessions.map((s) => ({ id: s.id as string | null, label: s.title?.trim() || fmt(t.adminEvlDayN, { n: s.sortOrder + 1 }) })),
  ];

  const sectionHead = (children: React.ReactNode, count: number, tint?: string, sub?: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, padding: "10px 16px", borderRadius: 14, background: tint ?? "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 10, color: "var(--text-primary)" }}>{children}</h3>
        {sub && <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{sub}</p>}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", flexShrink: 0 }}>{fmt(t.adminEvlMembers, { n: count })}</span>
    </div>
  );

  return (
    <Modal
      open={showAttendance}
      onClose={close}
      size="xl"
      title={activeEvent?.title || t.adminEvlRosterTitle}
      description={!loadingAttendance && !attendanceError ? fmt(t.adminEvlCheckedInOf, { done: checkInCount, total: registeredCount }) : undefined}
      footer={
        <button type="button" className="btn btn-primary" onClick={close}>
          {t.adminEvlClose}
        </button>
      }
    >
      {loadingAttendance ? (
        <LoadingState label={t.adminEvlLoadingRoster} />
      ) : attendanceError ? (
        <ErrorState
          title={t.adminEvlRosterErrorTitle}
          message={attendanceError}
          onRetry={activeEventId ? () => viewAttendance(activeEventId) : undefined}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Export is frequent and safe; Strike is destructive, so it sits far right, apart. */}
          {(showExportButton || showStrikeButton) && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {showExportButton && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div>
                    <button type="button" className="btn btn-ghost" onClick={exportAttendanceXlsx} aria-describedby="evl-export-hint">
                      <Download size={16} aria-hidden="true" />
                      {t.adminEvlExport}
                    </button>
                  </div>
                  <p id="evl-export-hint" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: 420 }}>
                    {canSeeRawMedicalDetail ? t.adminEvlExportHintFull : t.adminEvlExportHintThin}
                  </p>
                </div>
              )}
              {showStrikeButton && (
                <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <button type="button" className="btn btn-danger" onClick={openStrikesModal} aria-describedby="evl-strike-hint">
                    <AlertTriangle size={16} aria-hidden="true" />
                    {t.adminEvlStrike}
                  </button>
                  <p id="evl-strike-hint" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: 320, textAlign: "right" }}>
                    {t.adminEvlStrikeHint}
                  </p>
                </div>
              )}
            </div>
          )}

          {attendance.length > 0 && (
            <>
              {/* At-a-glance breakdown for the day in view. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                {attendanceSummaryTiles.map((tile) => (
                  <StatCard
                    key={tile.key}
                    label={tile.label}
                    value={tile.value}
                    hint={tile.sub ?? undefined}
                    tone={TILE_UI[tile.key]?.tone}
                    icon={TILE_UI[tile.key]?.icon}
                  />
                ))}
              </div>

              <div role="group" aria-label={t.adminEvlFiltersLabel} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Per-day picker, only for true multi-day events, so one person
                    who attended several days isn't read as duplicate people. */}
                {isMultiDayEvent && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                      <Calendar size={15} aria-hidden="true" />
                      {t.adminEvlDay}
                    </span>
                    {dayOptions.map((opt) => (
                      <FilterChip key={opt.id ?? "all"} active={selectedSessionId === opt.id} onClick={() => setSelectedSessionId(opt.id)}>
                        {opt.label}
                      </FilterChip>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {/* Filtering to condition-holders is signal-level (who, not what), so it
                      is available to staff admin roles and a president viewing their own
                      event, but not smo, whose thin roster has no medical signal. */}
                  {canSeeAttendeeContactAndMedical && (
                    <FilterChip tone="danger" active={filterMedical} onClick={() => setFilterMedical(!filterMedical)} icon={<HeartPulse size={14} />}>
                      {t.adminEvlFilterMedical}
                    </FilterChip>
                  )}
                  <FilterChip active={filterNotCheckedIn} onClick={() => setFilterNotCheckedIn(!filterNotCheckedIn)} icon={<Clock size={14} />}>
                    {t.adminEvlFilterNotCheckedIn}
                  </FilterChip>
                  {/* Strike counts are not PDPA-sensitive, so both no-show filters stay visible to attendance-only roles. */}
                  <FilterChip tone="danger" active={filterStrikeHistory} onClick={() => setFilterStrikeHistory(!filterStrikeHistory)} icon={<AlertCircle size={14} />}>
                    {t.adminEvlFilterStrikeHistory}
                  </FilterChip>
                  <FilterChip tone="danger" active={filterEventNoShow} onClick={() => setFilterEventNoShow(!filterEventNoShow)} icon={<AlertTriangle size={14} />}>
                    {t.adminEvlFilterNoShow}
                  </FilterChip>
                </div>

                <details>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", minHeight: 44, display: "flex", alignItems: "center" }}>
                    {moreFiltersOn > 0 ? fmt(t.adminEvlMoreFiltersOn, { n: moreFiltersOn }) : t.adminEvlMoreFilters}
                  </summary>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
                    <FilterChip active={filterStudentsOnly} onClick={() => setFilterStudentsOnly(!filterStudentsOnly)} icon={<User size={14} />}>
                      {t.adminEvlFilterStudentsOnly}
                    </FilterChip>
                    <FilterChip active={filterMaster} onClick={() => setFilterMaster(!filterMaster)} icon={<GraduationCap size={14} />}>
                      {t.adminEvlFilterMaster}
                    </FilterChip>
                    <FilterChip active={filterPhd} onClick={() => setFilterPhd(!filterPhd)} icon={<GraduationCap size={14} />}>
                      {t.adminEvlFilterPhd}
                    </FilterChip>
                    {([1, 2, 3, 4, 5] as const).map((yr) => (
                      <FilterChip
                        key={yr}
                        active={yearFilter.has(yr)}
                        onClick={() =>
                          setYearFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(yr)) next.delete(yr); else next.add(yr);
                            return next;
                          })
                        }
                      >
                        {yr === 5 ? t.adminEvlFilterYear5 : fmt(t.adminEvlFilterYear, { n: yr })}
                      </FilterChip>
                    ))}
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 8px", fontSize: 13, cursor: "pointer", color: "var(--text-secondary)" }}>
                      <input type="checkbox" checked={filterThai} onChange={(e) => setFilterThai(e.target.checked)} style={{ accentColor: "var(--accent-primary)", width: 16, height: 16 }} />
                      {t.adminEvlFilterThai}
                    </label>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 8px", fontSize: 13, cursor: "pointer", color: "var(--text-secondary)" }}>
                      <input type="checkbox" checked={filterInternational} onChange={(e) => setFilterInternational(e.target.checked)} style={{ accentColor: "var(--accent-primary)", width: 16, height: 16 }} />
                      {t.adminEvlFilterIntl}
                    </label>
                  </div>
                </details>

                {anyFilter && (
                  <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--text-secondary)" }}>
                    <Activity size={14} aria-hidden="true" />
                    {fmt(t.adminEvlShowing, { shown: attendanceUnits.length, total: tallyUnits.length })}
                    {filtersOn && (
                      <button type="button" className="btn btn-ghost" onClick={clearFilters}>
                        {t.adminEvlClearFilters}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {!hasRoster ? (
            <EmptyState icon={<Users size={24} />} title={t.adminEvlRosterEmptyTitle} description={t.adminEvlRosterEmptyBody} />
          ) : nothingMatches ? (
            <EmptyState
              icon={filterMedical ? <HeartPulse size={24} /> : <Users size={24} />}
              title={filterMedical ? t.adminEvlNoMedicalTitle : filterNotCheckedIn ? t.adminEvlAllCheckedInTitle : t.adminEvlNoMatchRosterTitle}
              description={filterMedical ? fmt(t.adminEvlNoMedicalBody, { n: attendance.length }) : filterNotCheckedIn ? t.adminEvlAllCheckedInBody : t.adminEvlNoMatchRosterBody}
              action={
                filtersOn ? (
                  <button type="button" className="btn btn-ghost" onClick={clearFilters}>
                    {t.adminEvlClearFilters}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {groupedAttendance.staff.length > 0 && (
                <section aria-label={t.adminEvlStaffGroup}>
                  {sectionHead(
                    <>
                      <ShieldCheck size={18} aria-hidden="true" />
                      {t.adminEvlStaffGroup}
                    </>,
                    groupedAttendance.staff.length,
                    "rgb(var(--indigo-500-rgb) / 0.08)",
                    t.adminEvlStaffGroupDesc,
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
                    {groupedAttendance.staff.map((unit) => <AttendanceCard key={unit.key} ctx={ctx} unit={unit} />)}
                  </div>
                </section>
              )}
              {Object.entries(groupedAttendance.houses).map(([house, members]: [string, AttendanceUnit[]]) => {
                const houseName = house === "red" ? t.houseMom : house === "green" ? t.houseTo : house === "yellow" ? t.houseLuang : house === "blue" ? t.houseMakara : house;
                const color = members[0]?.primary.user?.house?.color || "var(--accent-primary)";
                return (
                  <section key={house} aria-label={houseName}>
                    {sectionHead(
                      <>
                        <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: color, boxShadow: `0 0 12px ${alpha(color, 0.33)}` }} />
                        {houseName}
                      </>,
                      members.length,
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
                      {members.map((unit) => <AttendanceCard key={unit.key} ctx={ctx} unit={unit} />)}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
