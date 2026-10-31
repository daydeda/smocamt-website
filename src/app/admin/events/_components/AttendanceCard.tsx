"use client";

import { Calendar, CheckCircle2, Clock, Info, ShieldCheck, User, UserX, Activity } from "lucide-react";
import { IconButton, StatusBadge } from "@/components/admin/ui";
import { primaryRoleLabel } from "../_lib/event-model";
import type { AdminEventsPageCtx, AttendanceUnit } from "../_lib/useAdminEventsPage";
import { fmt } from "./fmt";

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" };
const timeOf = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-GB", TIME_OPTS) : "-");

/**
 * One roster card, shared by the Staff section and each house group.
 * PDPA: the medical SIGNAL badge and the meds-check badge keep exactly the
 * same gates as before (hasMedicalSignal / canSeeRawMedicalDetail); no medical
 * detail is rendered here.
 */
export function AttendanceCard({ ctx, unit }: { ctx: AdminEventsPageCtx; unit: AttendanceUnit }) {
  const { canExportAttendance, canRemoveRegistrant, canSeeRawMedicalDetail, eventStaffIds, hasMedicalSignal, removeRegistrant, removingStudentId, setSelectedStudent, t } = ctx;
  const m = unit.primary;
  // A person attending >1 session collapses into one card with a per-day breakdown
  // (only in the "All days" view).
  const multiDay = unit.rows.length > 1;
  const attendedDays = unit.rows.filter((r) => r.status === "attended").length;
  const assignedStaff = m.isStaff;
  const staffMember = assignedStaff || (!!m.user?.id && eventStaffIds.has(m.user.id));
  const unregistered = m.status === "not_registered";
  const name = m.user?.name || m.user?.studentId || "";
  const canProfile = !unregistered && canExportAttendance;
  const canRemove = !unregistered && canRemoveRegistrant && !!m.user?.id;
  const removing = !!m.user?.id && removingStudentId === m.user.id;

  const dayLabel = (r: AttendanceUnit["rows"][number]) =>
    r.session?.title?.trim() || fmt(t.adminEvlDayN, { n: (r.session?.sortOrder ?? 0) + 1 });

  // Meds-check badge reveals who went through the medication check (i.e. who has a
  // medical condition), so it is restricted exactly as before.
  const medsBadge = (option: string | null) => {
    if (!canSeeRawMedicalDetail || !option) return null;
    const tone = option === "brought" ? "success" : option === "forgot" ? "danger" : "info";
    const label = option === "brought" ? t.adminEvlMedsBrought : option === "forgot" ? t.adminEvlMedsForgot : t.adminEvlMedsAck;
    return (
      <div style={{ marginTop: 6 }}>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
    );
  };

  const statusBadge = multiDay ? (
    <StatusBadge tone={attendedDays > 0 ? "success" : "warning"} icon={<CheckCircle2 size={12} />}>
      {fmt(t.adminEvlDaysCheckedIn, { done: attendedDays, total: unit.rows.length })}
    </StatusBadge>
  ) : m.status === "attended" ? (
    <StatusBadge tone="success">{t.adminEvlStatusCheckedIn}</StatusBadge>
  ) : unregistered ? (
    <StatusBadge tone="neutral" icon={<User size={12} />}>{t.adminEvlStatusStaffPending}</StatusBadge>
  ) : (
    <StatusBadge tone="warning">{t.adminEvlStatusRegistered}</StatusBadge>
  );

  return (
    <article
      className="attendance-card"
      style={{ padding: 16, background: "var(--bg-surface)", borderRadius: 16, border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{m.user?.name}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap", fontSize: 13, color: "var(--text-muted)" }}>
          <span>{m.user?.studentId || t.adminEvlNoId}</span>
          {!multiDay && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Clock size={12} aria-hidden="true" />
              {timeOf(m.checkInTime)}
            </span>
          )}
          {staffMember && (
            <span title={`${assignedStaff ? t.adminEvlStaffAssigned : t.adminEvlStaffCheckedOthers} · ${fmt(t.adminEvlBaseRole, { role: primaryRoleLabel(m.user) })}`}>
              <StatusBadge tone="info" icon={<ShieldCheck size={12} />}>{primaryRoleLabel(m.user)}</StatusBadge>
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {statusBadge}
        {/* Signal only: that a condition exists, never the detail. */}
        {!unregistered && hasMedicalSignal(m.user) && (
          <StatusBadge tone="danger" icon={<Activity size={12} />}>{t.adminEvlMedicalSignal}</StatusBadge>
        )}
      </div>

      {multiDay ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {unit.rows.map((r) => {
            const checked = r.status === "attended";
            return (
              <div key={r.id} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--text-secondary)" }}>
                    <Calendar size={13} aria-hidden="true" />
                    {dayLabel(r)}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, flexShrink: 0, color: checked ? "var(--emerald-600)" : "var(--text-secondary)" }}>
                    {checked ? <CheckCircle2 size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
                    {checked ? (r.checkInTime ? timeOf(r.checkInTime) : t.adminEvlStatusCheckedIn) : t.adminEvlRegistered}
                  </span>
                </div>
                {medsBadge(r.medsCheckOption)}
              </div>
            );
          })}
        </div>
      ) : (
        medsBadge(m.medsCheckOption)
      )}

      {/* Frequent action on the left, destructive one far right, so a slip can't hit it. */}
      {(canProfile || canRemove) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}>
          {canProfile ? (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={fmt(t.adminEvlViewProfileLabel, { name })}
              onClick={() => setSelectedStudent(m.user || null)}
            >
              <Info size={16} aria-hidden="true" />
              {t.adminEvlViewProfile}
            </button>
          ) : <span />}
          {canRemove && (
            <IconButton
              tone="danger"
              label={fmt(t.adminEvlRemoveRegLabel, { name })}
              disabled={removing}
              icon={removing ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <UserX size={18} />}
              onClick={() => removeRegistrant(m.user!.id, m.user!.name || m.user!.studentId || "")}
            />
          )}
        </div>
      )}
    </article>
  );
}
