"use client";

import { Check, Plus, ShieldCheck, X } from "lucide-react";
import { Field, IconButton } from "@/components/admin/ui";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";
import { ChoiceFieldset } from "./FormControls";

export function EventStaffField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { assigneeUsers, canEditRestrictedFields, formData, setFormData, setStaffAssigneeSearch, staffAssigneeSearch, t } = ctx;
  const query = staffAssigneeSearch.trim().toLowerCase();
  const matches = query
    ? assigneeUsers
        .filter((u) => (u.name || "").toLowerCase().includes(query) || (u.studentId || "").toLowerCase().includes(query))
        .slice(0, 30)
    : [];
  return (
    <ChoiceFieldset
      legend={t.adminEvfEventStaff}
      icon={<ShieldCheck size={16} />}
      hint={t.adminEvfEventStaffHint}
      locked={!canEditRestrictedFields}
    >
      {formData.staffUserIds.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {formData.staffUserIds.map((uid) => {
            const u = assigneeUsers.find((x) => x.id === uid);
            const name = u ? (u.name || u.studentId || uid) : uid;
            return (
              <li
                key={uid}
                className="inline-flex items-center gap-1 rounded-full pl-3"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: 13, fontWeight: 600 }}
              >
                {name}
                <IconButton
                  size="sm"
                  label={t.adminEvfStaffRemove.replace("{name}", name)}
                  icon={<X size={14} />}
                  disabled={!canEditRestrictedFields}
                  onClick={() => setFormData({ ...formData, staffUserIds: formData.staffUserIds.filter((x) => x !== uid) })}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-field-hint">{t.adminEvfStaffNone}</p>
      )}

      <Field label={t.adminEvfStaffSearch}>
        {(p) => (
          <input
            {...p}
            type="search"
            className="input"
            autoComplete="off"
            placeholder={t.adminEvfSearchPeoplePh}
            value={staffAssigneeSearch}
            onChange={(e) => setStaffAssigneeSearch(e.target.value)}
          />
        )}
      </Field>

      {query.length > 0 && (
        <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
          {assigneeUsers.length === 0 ? (
            <p role="status" className="adm-field-hint p-3">{t.adminEvfPeopleLoading}</p>
          ) : matches.length === 0 ? (
            <p role="status" className="adm-field-hint p-3">{t.adminEvfNoMatches.replace("{q}", staffAssigneeSearch.trim())}</p>
          ) : (
            matches.map((u) => {
              const on = formData.staffUserIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      staffUserIds: on ? formData.staffUserIds.filter((x) => x !== u.id) : [...formData.staffUserIds, u.id],
                    })
                  }
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
    </ChoiceFieldset>
  );
}
