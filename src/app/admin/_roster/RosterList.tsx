"use client";

import { Fragment } from "react";
import { ChevronDown, ChevronUp, HeartPulse, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { NON_SMO_POSITION_IDS, POSITION_I18N_KEY, type PositionId } from "@/lib/access/positions";
import { IconButton, StatusBadge, TableScroll } from "@/components/admin/ui";

// One person on a club roster or a major team. Only data the viewer is already
// authorised to see reaches here (the members GET route shapes it server-side).
// Medical detail is NEVER part of a row: it is rendered through `renderMedical`
// only for the one expanded member.
export type RosterRow = {
  key: string;
  userId: string;
  name: string;
  studentId: string | null;
  meta: string[];
  contacts: string[];
  isPresident: boolean;
  position: string | null;
};

type Props = {
  rows: RosterRow[];
  tableLabel: string;
  /** Position <select> for non-president rows (otherwise a read-only badge). */
  editablePosition: boolean;
  onPositionChange?: (row: RosterRow, position: string | null) => void;
  /** Remove button on non-president rows. */
  onRemove?: (row: RosterRow) => void;
  removingUserId?: string | null;
  /** Medical & emergency toggle. Gated by the caller to the exact set the server allows. */
  canExpandMedical: boolean;
  expandedKey: string | null;
  onToggleExpand: (row: RosterRow) => void;
  renderMedical: (row: RosterRow) => React.ReactNode;
};

export function RosterList(props: Props) {
  const { t } = useLanguage();
  const { rows, tableLabel, editablePosition, onPositionChange, onRemove, removingUserId, canExpandMedical, expandedKey, onToggleExpand, renderMedical } = props;

  const hasContacts = rows.some((r) => r.contacts.length > 0);
  const hasActions = canExpandMedical || !!onRemove;
  const colCount = 3 + (hasContacts ? 1 : 0) + (hasActions ? 1 : 0);

  const positionLabel = (id: string) => {
    const key = POSITION_I18N_KEY[id as PositionId] as keyof typeof t | undefined;
    return (key && (t[key] as string)) || id;
  };

  const positionControl = (row: RosterRow, full?: boolean) => {
    if (row.isPresident) {
      // Locked: a president's position is always "President" (kept in sync server-side).
      return <StatusBadge tone="accent" icon={false}>{t.positionPresident}</StatusBadge>;
    }
    if (editablePosition && onPositionChange) {
      return (
        <select
          className="input"
          aria-label={t.adminCmPositionFor.replace("{name}", row.name)}
          style={{ width: full ? "100%" : 190, fontSize: 13 }}
          value={row.position || ""}
          onChange={(e) => onPositionChange(row, e.target.value || null)}
        >
          <option value="">{t.adminCmNoPosition}</option>
          {NON_SMO_POSITION_IDS.map((id) => (
            <option key={id} value={id}>{positionLabel(id)}</option>
          ))}
        </select>
      );
    }
    return row.position ? <StatusBadge tone="neutral" icon={false}>{positionLabel(row.position)}</StatusBadge> : <span style={{ color: "var(--text-muted)" }}>—</span>;
  };

  const actionButtons = (row: RosterRow, size: "sm" | "md") => {
    const expanded = expandedKey === row.key;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {canExpandMedical && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={expanded}
            aria-controls={`roster-medical-${size}-${row.key}`}
            aria-label={`${t.adminCmMedicalButton}: ${row.name}`}
            onClick={() => onToggleExpand(row)}
          >
            <HeartPulse size={14} aria-hidden="true" />
            {t.adminCmMedicalButton}
            {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        )}
        {onRemove && !row.isPresident && (
          // Destructive action sits apart from the frequent ones (Fitts / slip prevention).
          <span style={{ marginLeft: canExpandMedical ? 12 : 0, paddingLeft: canExpandMedical ? 12 : 0, borderLeft: canExpandMedical ? "1px solid var(--border-subtle)" : undefined }}>
            <IconButton
              tone="danger"
              size={size}
              label={t.adminCmRemoveMember.replace("{name}", row.name)}
              icon={removingUserId === row.userId ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Trash2 size={16} />}
              disabled={removingUserId === row.userId}
              onClick={() => onRemove(row)}
            />
          </span>
        )}
      </div>
    );
  };

  const identity = (row: RosterRow) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{row.name}</div>
      {row.studentId && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.studentId}</div>}
    </div>
  );

  return (
    <>
      {/* Laptop / tablet: table */}
      <div className="hidden sm:block">
        <TableScroll label={tableLabel}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColStudent}</th>
                <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColDetails}</th>
                {hasContacts && <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColContact}</th>}
                <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColPosition}</th>
                {hasActions && <th scope="col" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>{t.adminCmColActions}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = canExpandMedical && expandedKey === row.key;
                return (
                  <Fragment key={row.key}>
                    <tr>
                      <td>{identity(row)}</td>
                      <td style={{ fontSize: 13 }}>{row.meta.length ? row.meta.join(" · ") : "—"}</td>
                      {hasContacts && <td style={{ fontSize: 13, overflowWrap: "anywhere" }}>{row.contacts.length ? row.contacts.join(" · ") : "—"}</td>}
                      <td>{positionControl(row)}</td>
                      {hasActions && <td>{actionButtons(row, "sm")}</td>}
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={colCount} id={`roster-medical-sm-${row.key}`} style={{ background: "var(--bg-elevated)" }}>
                          {renderMedical(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>

      {/* Phones: cards */}
      <ul className="sm:hidden" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => {
          const expanded = canExpandMedical && expandedKey === row.key;
          return (
            <li key={row.key} style={{ border: "1px solid var(--border-subtle)", borderRadius: 14, background: "var(--bg-surface)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {identity(row)}
              {(row.meta.length > 0 || row.contacts.length > 0) && (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 2, overflowWrap: "anywhere" }}>
                  {row.meta.length > 0 && <span>{row.meta.join(" · ")}</span>}
                  {row.contacts.length > 0 && <span>{row.contacts.join(" · ")}</span>}
                </div>
              )}
              <div>{positionControl(row, true)}</div>
              {hasActions && actionButtons(row, "md")}
              {expanded && (
                <div id={`roster-medical-md-${row.key}`} style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 12 }}>
                  {renderMedical(row)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
