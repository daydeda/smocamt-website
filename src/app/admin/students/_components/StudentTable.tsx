"use client";

import { Activity, Edit2, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { IconButton, StatusBadge, TableScroll } from "@/components/admin/ui";
import { NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import { alpha } from "@/lib/ui/color";
import { fill, hasActualMedicalInfo, ITEMS_PER_PAGE, rolesOf, type Student } from "../_lib/students";
import { RoleBadges } from "./RoleBadges";

export type StudentRowHandlers = {
  onEdit: (s: Student) => void;
  onDelete: (s: Student) => void;
  onMedical: (s: Student) => void;
  onResetStrikes: (s: Student) => void;
};

type CommonProps = StudentRowHandlers & {
  canEditOrDelete: boolean;
  canViewMedicalLog: boolean;
  /** The signed-in user's primary role. */
  userRole: string;
  resettingStrikesId: string | null;
  getHouseName: (id: string, defaultName: string) => string;
};

function StudentActions({
  s,
  canEditOrDelete,
  canViewMedicalLog,
  userRole,
  resettingStrikesId,
  onEdit,
  onDelete,
  onMedical,
  onResetStrikes,
  withIds,
}: CommonProps & { s: Student; withIds?: boolean }) {
  const { t } = useLanguage();
  const isTargetSuperAdmin = s.role === "super_admin";
  const canModifyThisRow = canEditOrDelete && (!isTargetSuperAdmin || userRole === "super_admin");
  const resetting = resettingStrikesId === s.id;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={!canModifyThisRow}
        aria-label={fill(canModifyThisRow ? t.adminStuEditAria : t.adminStuEditRestricted, { name: s.name })}
        title={fill(canModifyThisRow ? t.adminStuEditAria : t.adminStuEditRestricted, { name: s.name })}
        onClick={() => onEdit(s)}
      >
        <Edit2 size={14} aria-hidden="true" /> {t.adminStuEdit}
      </button>
      {canViewMedicalLog && (
        <button
          type="button"
          id={withIds ? `view-sensitive-${s.id}-btn` : undefined}
          className="btn btn-ghost btn-sm"
          aria-label={fill(t.adminStuMedicalBtnAria, { name: s.name })}
          onClick={() => onMedical(s)}
        >
          <ShieldAlert size={14} aria-hidden="true" style={{ color: "var(--red-600)" }} /> {t.adminStuMedicalBtn}
        </button>
      )}
      {/* Destructive action: last, beside Medical record. */}
      <IconButton
        size="sm"
        tone="danger"
        icon={<Trash2 size={16} />}
        label={fill(canModifyThisRow ? t.adminStuDeleteAria : t.adminStuDeleteRestricted, { name: s.name })}
        disabled={!canModifyThisRow}
        onClick={() => onDelete(s)}
      />
      {canEditOrDelete && (s.noShowCount ?? 0) > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={resetting}
          aria-busy={resetting}
          aria-label={fill(t.adminStuResetStrikesAria, { name: s.name })}
          onClick={() => onResetStrikes(s)}
        >
          {resetting ? <span className="spinner" style={{ width: 14, height: 14 }} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
          {" "}{t.adminStuResetStrikes}
        </button>
      )}
    </div>
  );
}

function StudentIdentity({ s }: { s: Student }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 15, lineHeight: 1.5 }}>
        {s.prefix || ""}{s.name}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        <code style={{ fontWeight: 600 }}>{s.studentId ?? t.adminStuNoId}</code>
        {s.nickname ? <> · &ldquo;{s.nickname}&rdquo;</> : null}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <RoleBadges roles={rolesOf(s)} />
        {/* Signal only (same as before): the detail stays behind the audited medical record. */}
        {hasActualMedicalInfo(s) && (
          <StatusBadge tone="danger" icon={<Activity size={12} />}>{t.adminStuMedicalSignal}</StatusBadge>
        )}
      </div>
    </div>
  );
}

function StudentStatus({ s }: { s: Student }) {
  const { t } = useLanguage();
  const strikes = s.noShowCount ?? 0;
  const severe = !!s.registrationBlocked || strikes >= NO_SHOW_STRIKE_THRESHOLD - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <StatusBadge tone={s.profileCompleted ? "success" : "warning"}>
        {s.profileCompleted ? t.adminStuProfileComplete : t.adminStuProfilePending}
      </StatusBadge>
      {strikes > 0 && (
        <span title={s.registrationBlocked ? t.adminStuBlockedTitle : t.adminStuStrikesTitle}>
          <StatusBadge tone={severe ? "danger" : "warning"}>
            {fill(t.adminStuStrikes, { n: strikes, max: NO_SHOW_STRIKE_THRESHOLD })}
            {s.registrationBlocked ? ` · ${t.adminStuBlocked}` : ""}
          </StatusBadge>
        </span>
      )}
    </div>
  );
}

function HouseCell({ s, getHouseName }: { s: Student; getHouseName: CommonProps["getHouseName"] }) {
  const { t } = useLanguage();
  if (!s.house) return <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{t.unassignedLabel}</span>;
  const color = s.house.color || "var(--accent-primary)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${alpha(color, 0.27)}`, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{getHouseName(s.house.id, s.house.name)}</span>
    </span>
  );
}

export function StudentTable({
  students,
  total,
  page,
  onPageChange,
  ...common
}: CommonProps & {
  students: Student[];
  /** Number of students matching the current filters (all pages). */
  total: number;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLanguage();
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const from = (page - 1) * ITEMS_PER_PAGE + 1;
  const to = Math.min(page * ITEMS_PER_PAGE, total);

  return (
    <section className="adm-panel">
      {/* Tablet and up: table */}
      <div className="hidden sm:block">
        <TableScroll label={t.adminStuTableLabel}>
          <table className="data-table" style={{ tableLayout: "fixed", minWidth: 900 }}>
            {/* Student gets the room; the rest are sized to their content. */}
            <colgroup>
              <col style={{ width: "32%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "25%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t.adminStuColStudent}</th>
                <th>{t.adminStuColMajor}</th>
                <th>{t.adminStuColHouse}</th>
                <th>{t.adminStuColStatus}</th>
                <th>{t.adminStuColActions}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td><StudentIdentity s={s} /></td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 14 }}>{s.major || t.adminStuNoMajor}</td>
                  <td><HouseCell s={s} getHouseName={common.getHouseName} /></td>
                  <td><StudentStatus s={s} /></td>
                  <td><StudentActions s={s} {...common} withIds /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>

      {/* Phones: one card per student */}
      <ul className="sm:hidden" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label={t.adminStuTableLabel}>
        {students.map((s) => (
          <li key={s.id} style={{ padding: 16, borderBottom: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
            <StudentIdentity s={s} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 14, color: "var(--text-secondary)", alignItems: "center" }}>
              <span>{s.major || t.adminStuNoMajor}</span>
              <HouseCell s={s} getHouseName={common.getHouseName} />
            </div>
            <StudentStatus s={s} />
            <StudentActions s={s} {...common} />
          </li>
        ))}
      </ul>

      {total > ITEMS_PER_PAGE && (
        <nav
          aria-label={t.adminStuPagination}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "14px 20px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}
        >
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {fill(t.adminStuShowing, { from, to, total })}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
              {t.adminStuPrev}
            </button>
            <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700 }} aria-live="polite">
              {fill(t.adminStuPage, { page, total: totalPages })}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={page === totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>
              {t.adminStuNext}
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
