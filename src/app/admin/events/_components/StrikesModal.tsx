"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { NO_SHOW_PENALTY_MAX, NO_SHOW_PENALTY_MIN, NO_SHOW_PENALTY_POINTS, NO_SHOW_STRIKE_THRESHOLD } from "@/lib/points/strikes";
import { EmptyState, Field, InlineAlert, LoadingState, Modal, StatusBadge, TableScroll } from "@/components/admin/ui";
import type { AdminEventsPageCtx } from "../_lib/useAdminEventsPage";
import { fmt } from "./fmt";

// Kit rule: no uppercase or tracked labels; .data-table th defaults to both.
const TH: React.CSSProperties = { textTransform: "none", letterSpacing: 0, fontSize: 12 };

export function StrikesModal({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { activeEvent, confirmApplyStrikes, setShowStrikesModal, setStrikesPoints, setStrikesPreview, setStrikesResult, setStrikesSelected, showStrikesModal, strikesLoading, strikesPoints, strikesPreview, strikesResult, strikesSelected, strikesSubmitting, t } = ctx;

  const close = () => {
    setShowStrikesModal(false);
    setStrikesResult(null);
    setStrikesPreview([]);
    setStrikesSelected(new Set());
  };
  const allSelected = strikesPreview.length > 0 && strikesSelected.size === strikesPreview.length;
  const toggleAll = () => setStrikesSelected(allSelected ? new Set() : new Set(strikesPreview.map((s) => s.id)));
  const canApply = !strikesResult && strikesPreview.length > 0;

  return (
    <Modal
      open={showStrikesModal}
      onClose={close}
      size="lg"
      dismissible={!strikesSubmitting}
      icon={<AlertTriangle size={20} />}
      title={t.adminEvlStrike}
      description={
        <>
          {activeEvent?.title && <span style={{ display: "block", fontWeight: 600, color: "var(--text-primary)" }}>{fmt(t.adminEvlStrikeEventLine, { title: activeEvent.title })}</span>}
          {fmt(t.adminEvlStrikeDesc, { n: NO_SHOW_STRIKE_THRESHOLD })}
        </>
      }
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={strikesSubmitting}>
            {strikesResult ? t.adminEvlClose : t.cancel}
          </button>
          {canApply && (
            <button
              type="button"
              className="btn adm-btn-danger-solid"
              disabled={strikesSubmitting || strikesSelected.size === 0}
              onClick={confirmApplyStrikes}
            >
              {strikesSubmitting ? t.adminEvlStrikeApplying : fmt(t.adminEvlStrikeBtn, { n: strikesSelected.size })}
            </button>
          )}
        </>
      }
    >
      {strikesLoading ? (
        <LoadingState compact label={t.adminEvlStrikeLoading} />
      ) : strikesResult ? (
        <InlineAlert tone="success" title={t.adminEvlStrikeApplied}>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "flex-start" }}>
            <CheckCircle2 size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
            {fmt(t.adminEvlStrikeResult, { struck: strikesResult.struck, points: strikesResult.pointsDeducted, blocked: strikesResult.blocked })}
          </span>
        </InlineAlert>
      ) : strikesPreview.length === 0 ? (
        <EmptyState compact icon={<CheckCircle2 size={24} />} title={t.adminEvlStrikeNone} description={t.adminEvlStrikeNoneBody} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field
            label={t.adminEvlStrikePointsLabel}
            hint={fmt(t.adminEvlStrikePointsHint, { min: NO_SHOW_PENALTY_MIN, max: NO_SHOW_PENALTY_MAX })}
          >
            {(p) => (
              <input
                {...p}
                className="input"
                type="number"
                inputMode="numeric"
                min={NO_SHOW_PENALTY_MIN}
                max={NO_SHOW_PENALTY_MAX}
                value={strikesPoints}
                disabled={strikesSubmitting}
                style={{ maxWidth: 120 }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setStrikesPoints(v);
                }}
                onBlur={() => setStrikesPoints((v) => Math.min(NO_SHOW_PENALTY_MAX, Math.max(NO_SHOW_PENALTY_MIN, Math.round(v) || NO_SHOW_PENALTY_POINTS)))}
              />
            )}
          </Field>

          <InlineAlert tone="warning">{fmt(t.adminEvlStrikeWarn, { points: strikesPoints })}</InlineAlert>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {fmt(t.adminEvlStrikeSelected, { n: strikesSelected.size, total: strikesPreview.length })}
            </p>
            <button type="button" className="btn btn-ghost" onClick={toggleAll} disabled={strikesSubmitting}>
              {allSelected ? t.adminEvlDeselectAll : t.adminEvlSelectAll}
            </button>
          </div>

          <TableScroll label={t.adminEvlStrike}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ ...TH, width: 44 }}><span className="sr-only">{t.adminEvlSelectAll}</span></th>
                  <th style={TH}>{t.adminEvlColStudent}</th>
                  <th style={TH}>{t.adminEvlColStudentId}</th>
                  <th className="num" style={TH}>{t.adminEvlColStrikes}</th>
                </tr>
              </thead>
              <tbody>
                {strikesPreview.map((s) => {
                  const checked = strikesSelected.has(s.id);
                  const label = `${s.name}${s.nickname ? ` (${s.nickname})` : ""}`;
                  return (
                    <tr key={s.id} style={{ opacity: checked ? 1 : 0.6 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={fmt(t.adminEvlSelectStudent, { name: label })}
                          disabled={strikesSubmitting}
                          onChange={() => setStrikesSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                            return next;
                          })}
                          style={{ width: 18, height: 18, accentColor: "var(--red-600)" }}
                        />
                      </td>
                      <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>{label}</td>
                      <td>{s.studentId || "—"}</td>
                      <td className="num">
                        {s.noShowCount > 0 ? <StatusBadge tone="danger">{s.noShowCount + 1}/{NO_SHOW_STRIKE_THRESHOLD}</StatusBadge> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </Modal>
  );
}
