"use client";

import { Calendar, Clock, User, Users, Search, X, AlertCircle, RefreshCw, Activity, HeartPulse, Download, ShieldCheck, AlertTriangle, GraduationCap } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import type { AdminEventsPageCtx, AttendanceUnit } from "../_lib/useAdminEventsPage";

export function AttendanceModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { activeEvent, activeEventId, activeEventSessions, attendance, attendanceError, attendanceSummaryTiles, attendanceUnits, canSeeAttendeeContactAndMedical, canSeeRawMedicalDetail, checkInCount, exportAttendanceXlsx, filterEventNoShow, filterInternational, filterMaster, filterMedical, filterNotCheckedIn, filterPhd, filterStrikeHistory, filterStudentsOnly, filterThai, filteredAttendance, groupedAttendance, isMultiDayEvent, lang, loadingAttendance, openStrikesModal, registeredCount, renderAttendanceCard, selectedSessionId, setFilterEventNoShow, setFilterInternational, setFilterMaster, setFilterMedical, setFilterNotCheckedIn, setFilterPhd, setFilterStrikeHistory, setFilterStudentsOnly, setFilterThai, setSelectedSessionId, setShowAttendance, setYearFilter, showAttendance, showExportButton, showStrikeButton, t, tallyUnits, viewAttendance, yearFilter } = ctx;
  return (
    <>{showAttendance && (
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
                    background: "var(--emerald-500)",
                    boxShadow: "0 0 12px rgb(var(--emerald-500-rgb) / 0.6)",
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
                      color: "var(--text-on-color)",
                      background: "linear-gradient(135deg, var(--emerald-500), var(--emerald-600))",
                      border: "1px solid var(--emerald-600)",
                      boxShadow: "0 8px 20px rgb(var(--emerald-500-rgb) / 0.35)",
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
                      color: "var(--text-on-color)",
                      background: "linear-gradient(135deg, var(--red-500), var(--red-600))",
                      border: "1px solid var(--red-600)",
                      boxShadow: "0 8px 20px rgb(var(--red-500-rgb) / 0.35)",
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
                      border: filterMedical ? "1px solid var(--red-500)" : "1px solid var(--border-subtle)",
                      background: filterMedical ? "rgb(var(--red-500-rgb) / 0.1)" : "var(--bg-surface)",
                      color: filterMedical ? "var(--red-500)" : "var(--text-secondary)"
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
                      border: filterStrikeHistory ? "1px solid var(--red-500)" : "1px solid var(--border-subtle)",
                      background: filterStrikeHistory ? "rgb(var(--red-500-rgb) / 0.1)" : "var(--bg-surface)",
                      color: filterStrikeHistory ? "var(--red-500)" : "var(--text-secondary)"
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
                      border: filterEventNoShow ? "1px solid var(--red-500)" : "1px solid var(--border-subtle)",
                      background: filterEventNoShow ? "rgb(var(--red-500-rgb) / 0.1)" : "var(--bg-surface)",
                      color: filterEventNoShow ? "var(--red-500)" : "var(--text-secondary)"
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
                    background: filterThai ? "rgb(var(--accent-rgb) / 0.08)" : "var(--bg-surface)",
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
                    background: filterInternational ? "rgb(var(--accent-rgb) / 0.08)" : "var(--bg-surface)",
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
                  <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgb(var(--red-500-rgb) / 0.1)", border: "1px solid rgb(var(--red-500-rgb) / 0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--red-500)" }}>
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
                      {filterMedical ? <HeartPulse size={40} style={{ color: "var(--red-500)" }} /> : <Search size={40} />}
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
                          background: "rgb(var(--indigo-500-rgb) / 0.08)",
                          borderRadius: 16,
                          border: "1px solid rgb(var(--indigo-500-rgb) / 0.2)"
                        }}>
                          <div>
                            <h4 style={{ fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 12, color: "var(--indigo-500)" }}>
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
                              boxShadow: `0 0 15px ${alpha(members[0]?.primary.user?.house?.color || "var(--accent-primary)", 0.33)}`
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
      )}</>
  );
}
