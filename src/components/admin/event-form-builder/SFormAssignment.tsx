"use client";

import { ClipboardList } from "lucide-react";
import { ASSIGNABLE_FORM_ROLES, ASSIGNABLE_ROLE_LABELS } from "./form-builder-model";
import type { EventFormBuilderCtx } from "./useEventFormBuilder";

export function SFormAssignment({ ctx }: { ctx: EventFormBuilderCtx }) {
  const { activeFormType, assigneeSearch, assigneeUsers, formAssignedRoles, formAssignedUserIds, formIsAwarded, setAssigneeSearch, setFormAssignedRoles, setFormAssignedUserIds, t } = ctx;
  return (
    <>{activeFormType === "S" && (
                      <div style={{ background: "rgb(var(--red-500-rgb) / 0.04)", padding: 24, borderRadius: 24, border: "1px solid rgb(var(--red-500-rgb) / 0.2)", display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ClipboardList size={16} style={{ color: "var(--red-500)" }} />
                          <h4 style={{ fontSize: 14, fontWeight: 900 }}>{t.fbSFormWhoCanFill || "Who can do this form"}</h4>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
                          {t.fbSFormDesc || "Skill forms are hidden from everyone except super-admins/admins and the people you assign here (by role or by person). It appears in their dashboard history to fill — no event check-in needed."}
                        </p>

                        {/* By role */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.fbSFormAssignByRole || "Assign by role"}</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                            {ASSIGNABLE_FORM_ROLES.map((role) => {
                              const on = formAssignedRoles.includes(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  disabled={formIsAwarded}
                                  onClick={() => setFormAssignedRoles((prev) => on ? prev.filter((r) => r !== role) : [...prev, role])}
                                  style={{
                                    padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 800, cursor: formIsAwarded ? "not-allowed" : "pointer",
                                    background: on ? "rgb(var(--red-500-rgb) / 0.12)" : "var(--bg-surface)",
                                    color: on ? "var(--red-500)" : "var(--text-secondary)",
                                    border: on ? "1.5px solid rgb(var(--red-500-rgb) / 0.4)" : "1.5px solid var(--border-subtle)",
                                  }}
                                >
                                  {on ? "✓ " : ""}{ASSIGNABLE_ROLE_LABELS[role] || role}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* By person */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.fbSFormAssignPeople || "Assign specific people"} ({formAssignedUserIds.length})</span>
                          {/* Selected chips */}
                          {formAssignedUserIds.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                              {formAssignedUserIds.map((uid) => {
                                const u = assigneeUsers.find((x) => x.id === uid);
                                return (
                                  <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 800, background: "rgb(var(--red-500-rgb) / 0.1)", color: "var(--red-500)", border: "1px solid rgb(var(--red-500-rgb) / 0.25)" }}>
                                    {u ? (u.name || u.studentId || uid) : uid}
                                    <button type="button" disabled={formIsAwarded} onClick={() => setFormAssignedUserIds((prev) => prev.filter((x) => x !== uid))} style={{ background: "none", border: "none", color: "var(--red-500)", cursor: "pointer", fontWeight: 900, fontSize: 13, lineHeight: 1 }}>✕</button>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <input
                            type="text"
                            className="input"
                            style={{ width: "100%", height: 42, borderRadius: 12, padding: "0 14px", marginTop: 10 }}
                            placeholder={t.fbSFormSearchPlaceholder || "Search people by name or student ID…"}
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            disabled={formIsAwarded}
                          />
                          {assigneeSearch.trim().length > 0 && (
                            <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                              {assigneeUsers
                                .filter((u) => {
                                  const q = assigneeSearch.trim().toLowerCase();
                                  return (u.name || "").toLowerCase().includes(q) || (u.studentId || "").toLowerCase().includes(q);
                                })
                                .slice(0, 30)
                                .map((u) => {
                                  const on = formAssignedUserIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      disabled={formIsAwarded}
                                      onClick={() => setFormAssignedUserIds((prev) => on ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                                      style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgb(var(--red-500-rgb) / 0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                                    >
                                      <span style={{ fontWeight: 700 }}>{u.name || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {u.studentId || u.role}</span></span>
                                      <span style={{ fontSize: 12, fontWeight: 900, color: on ? "var(--red-500)" : "var(--accent-primary)" }}>{on ? (t.fbSFormAddedLabel || "✓ Added") : (t.fbSFormAddLabel || "+ Add")}</span>
                                    </button>
                                  );
                                })}
                              {assigneeUsers.length === 0 && (
                                <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>{t.fbSFormLoadingPeople || "Loading people…"}</p>
                              )}
                            </div>
                          )}
                        </div>

                        {formAssignedRoles.length === 0 && formAssignedUserIds.length === 0 && (
                          <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                            {t.fbSFormNoOneAssigned || "No one assigned yet — only super-admins/admins can see and fill this form."}
                          </p>
                        )}
                      </div>
                    )}</>
  );
}
