"use client";

import { Check, ClipboardList, Plus, X } from "lucide-react";
import { Field, IconButton, InlineAlert, Panel } from "@/components/admin/ui";
import { ChipCheck } from "@/app/admin/events/_components/event-form/FormControls";
import { ASSIGNABLE_FORM_ROLES, ASSIGNABLE_ROLE_LABELS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function SFormAssignment({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormType, assigneeSearch, assigneeUsers, formAssignedRoles, formAssignedUserIds, formIsAwarded, setAssigneeSearch, setFormAssignedRoles, setFormAssignedUserIds, t } = ctx;
  if (activeFormType !== "S") return null;
  const query = assigneeSearch.trim().toLowerCase();
  const matches = query
    ? assigneeUsers
        .filter((u) => (u.name || "").toLowerCase().includes(query) || (u.studentId || "").toLowerCase().includes(query))
        .slice(0, 30)
    : [];
  return (
    <Panel title={t.fbSFormWhoCanFill} icon={<ClipboardList size={16} />} description={t.fbSFormDesc}>
      {/* A frozen (awarded) form cannot change its assignees. */}
      <fieldset disabled={formIsAwarded} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        {/* By role */}
        <div className="flex flex-col gap-2">
          <p className="adm-field-label">{t.fbSFormAssignByRole}</p>
          <div className="flex flex-wrap gap-2">
            {ASSIGNABLE_FORM_ROLES.map((role) => {
              const on = formAssignedRoles.includes(role);
              return (
                <ChipCheck
                  key={role}
                  checked={on}
                  accent="var(--red-500)"
                  onChange={() => setFormAssignedRoles((prev) => (on ? prev.filter((r) => r !== role) : [...prev, role]))}
                >
                  {ASSIGNABLE_ROLE_LABELS[role] || role}
                </ChipCheck>
              );
            })}
          </div>
        </div>

        {/* By person */}
        <div className="flex flex-col gap-3">
          <p className="adm-field-label">{t.fbSFormAssignPeople} ({formAssignedUserIds.length})</p>
          {formAssignedUserIds.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {formAssignedUserIds.map((uid) => {
                const u = assigneeUsers.find((x) => x.id === uid);
                const name = u ? (u.name || u.studentId || uid) : uid;
                return (
                  <li key={uid} className="inline-flex items-center gap-1 rounded-full pl-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: 13, fontWeight: 600 }}>
                    {name}
                    <IconButton
                      size="sm"
                      label={t.adminEvfStaffRemove.replace("{name}", name)}
                      icon={<X size={14} />}
                      disabled={formIsAwarded}
                      onClick={() => setFormAssignedUserIds((prev) => prev.filter((x) => x !== uid))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <Field label={t.adminEvfStaffSearch}>
            {(p) => (
              <input
                {...p}
                type="search"
                className="input"
                autoComplete="off"
                placeholder={t.fbSFormSearchPlaceholder}
                value={assigneeSearch}
                onChange={(e) => setAssigneeSearch(e.target.value)}
              />
            )}
          </Field>
          {query.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
              {assigneeUsers.length === 0 ? (
                <p role="status" className="adm-field-hint p-3">{t.fbSFormLoadingPeople}</p>
              ) : matches.length === 0 ? (
                <p role="status" className="adm-field-hint p-3">{t.adminEvfNoMatches.replace("{q}", assigneeSearch.trim())}</p>
              ) : (
                matches.map((u) => {
                  const on = formAssignedUserIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFormAssignedUserIds((prev) => (on ? prev.filter((x) => x !== u.id) : [...prev, u.id]))}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                      style={{ border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "var(--bg-elevated)" : "transparent", cursor: "pointer", fontSize: 14, color: "var(--text-primary)" }}
                    >
                      <span className="min-w-0" style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                        {u.name || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {u.studentId || u.role}</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1" style={{ fontSize: 13, fontWeight: 700, color: on ? "var(--text-primary)" : "var(--accent-primary)" }}>
                        {on ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                        {on ? t.adminEvfStaffAdded : t.adminEvfStaffAdd}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {formAssignedRoles.length === 0 && formAssignedUserIds.length === 0 && (
          <InlineAlert tone="info">{t.fbSFormNoOneAssigned}</InlineAlert>
        )}
      </fieldset>
    </Panel>
  );
}
