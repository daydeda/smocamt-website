"use client";

import { Plus, Trash2 } from "lucide-react";
import { Field, IconButton, InlineAlert, useConfirm } from "@/components/admin/ui";
import { sessionSpansTooLong } from "@/lib/events/event-schema";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ReqMark } from "./FormControls";

export function SessionsEditor({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { addSessionRow, formData, registrationMode, removeSessionRow, sessions, splitSessionRow, t, updateSessionRow } = ctx;
  const confirm = useConfirm();
  if (registrationMode === null) return null;

  const dayName = (idx: number) => sessions[idx]?.title?.trim() || t.adminEvfDayN.replace("{n}", String(idx + 1));

  const onRemove = async (idx: number) => {
    const name = dayName(idx);
    const ok = await confirm({
      title: t.adminEvfRemoveDayTitle.replace("{name}", name),
      message: t.adminEvfRemoveDayMsg,
      confirmLabel: t.adminEvfRemoveDayBtn,
      tone: "danger",
    });
    if (ok) removeSessionRow(idx);
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="adm-field-label" style={{ fontSize: 14 }}>{t.sessionsHeading}</h3>
      <InlineAlert tone="info">{registrationMode === "per_session" ? t.sessionsNotePerSession : t.sessionsNoteOnce}</InlineAlert>

      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {sessions.map((s, idx) => (
          <li
            key={s.id ?? `new-${idx}`}
            className="flex flex-col gap-4 rounded-[12px] p-4"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-medium)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="flex items-center gap-2.5" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.5, color: "var(--text-primary)" }}>
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center rounded-full"
                  style={{ width: 26, height: 26, fontSize: 12, fontWeight: 800, color: "var(--accent-primary)", background: "rgb(var(--accent-rgb) / 0.12)" }}
                >
                  {idx + 1}
                </span>
                {t.adminEvfDayN.replace("{n}", String(idx + 1))}
              </h4>
              <IconButton
                size="sm"
                tone="danger"
                label={t.adminEvfRemoveDayN.replace("{n}", String(idx + 1))}
                icon={<Trash2 size={16} />}
                onClick={() => onRemove(idx)}
                disabled={sessions.length <= 1}
              />
            </div>

            <Field label={t.sessionTitleLabel}>
              {(p) => (
                <input
                  {...p}
                  className="input"
                  value={s.title}
                  onChange={(e) => updateSessionRow(idx, { title: e.target.value })}
                  placeholder={t.adminEvfDayN.replace("{n}", String(idx + 1))}
                />
              )}
            </Field>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={t.eventStartTimeLabel}>
                {(p) => (
                  <input {...p} className="input" type="datetime-local" lang="en-GB" value={s.startTime} onChange={(e) => updateSessionRow(idx, { startTime: e.target.value })} />
                )}
              </Field>
              <Field label={t.eventEndTimeLabel}>
                {(p) => (
                  <input {...p} className="input" type="datetime-local" lang="en-GB" value={s.endTime} onChange={(e) => updateSessionRow(idx, { endTime: e.target.value })} />
                )}
              </Field>
            </div>

            {sessionSpansTooLong(s.startTime, s.endTime) && (
              <InlineAlert tone="warning">
                <div className="flex flex-col items-start gap-2">
                  <span>{t.multiDaySessionWarning}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => splitSessionRow(idx)}>
                    {t.splitIntoDays}
                  </button>
                </div>
              </InlineAlert>
            )}

            {formData.walkInsEnabled && !formData.walkInsOnly && (
              <Field label={t.sessionWalkInQuota} hint={t.unlimitedIfEmpty}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={s.quotaWalkIn ?? ""}
                    onChange={(e) => updateSessionRow(idx, { quotaWalkIn: e.target.value ? Number(e.target.value) : null })}
                  />
                )}
              </Field>
            )}

            {formData.checkInMode === "evidence" && (
              <div className="grid grid-cols-1 gap-3 rounded-[12px] p-3 md:grid-cols-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                <Field label={<>{t.adminEvfCodeWord}<ReqMark /></>} hint={t.adminEvfCodeWordHint}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="text"
                      autoComplete="off"
                      value={s.evidenceNonce ?? ""}
                      onChange={(e) => updateSessionRow(idx, { evidenceNonce: e.target.value || null })}
                      placeholder={t.adminEvfCodeWordPh}
                    />
                  )}
                </Field>
                <Field label={t.adminEvfDayPrompt} hint={t.adminEvfDayPromptHint}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="text"
                      value={s.evidencePrompt ?? ""}
                      onChange={(e) => updateSessionRow(idx, { evidencePrompt: e.target.value || null })}
                      placeholder={t.adminEvfDayPromptPh}
                    />
                  )}
                </Field>
              </div>
            )}
          </li>
        ))}
      </ol>

      <button type="button" onClick={addSessionRow} className="btn btn-ghost self-start">
        <Plus size={16} aria-hidden="true" /> {t.addDay}
      </button>
    </div>
  );
}
