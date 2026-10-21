"use client";

import { ShieldCheck } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function EventStaffField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { assigneeUsers, canEditRestrictedFields, formData, lang, setFormData, setStaffAssigneeSearch, staffAssigneeSearch, t } = ctx;
  return (
    <div className="field" style={{ opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} style={{ color: "var(--indigo-500)" }} />
                    {lang === "th" ? "ทีมงานของกิจกรรมนี้" : "Event Staff"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกคนที่ช่วยดูแลกิจกรรมนี้โดยเฉพาะ (ไม่นับรวมในโควตาผู้เข้าร่วม และไม่ถูกตัดคะแนนขาดงาน)"
                      : "Pick specific people staffing this event. Their registration/check-in won't count against the participant quota and they're exempt from no-show strikes."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {formData.staffUserIds.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      {formData.staffUserIds.map((uid) => {
                        const u = assigneeUsers.find((x) => x.id === uid);
                        return (
                          <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 800, background: "rgb(var(--indigo-500-rgb) / 0.1)", color: "var(--indigo-500)", border: "1px solid rgb(var(--indigo-500-rgb) / 0.25)" }}>
                            {u ? (u.name || u.studentId || uid) : uid}
                            <button type="button" disabled={!canEditRestrictedFields} onClick={() => setFormData({ ...formData, staffUserIds: formData.staffUserIds.filter((x) => x !== uid) })} style={{ background: "none", border: "none", color: "var(--indigo-500)", cursor: "pointer", fontWeight: 900, fontSize: 13, lineHeight: 1 }}>✕</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", height: 42, borderRadius: 12, padding: "0 14px" }}
                    placeholder={lang === "th" ? "ค้นหาด้วยชื่อหรือรหัสนักศึกษา…" : "Search people by name or student ID…"}
                    value={staffAssigneeSearch}
                    onChange={(e) => setStaffAssigneeSearch(e.target.value)}
                    disabled={!canEditRestrictedFields}
                  />
                  {staffAssigneeSearch.trim().length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)" }}>
                      {assigneeUsers
                        .filter((u) => {
                          const q = staffAssigneeSearch.trim().toLowerCase();
                          return (u.name || "").toLowerCase().includes(q) || (u.studentId || "").toLowerCase().includes(q);
                        })
                        .slice(0, 30)
                        .map((u) => {
                          const on = formData.staffUserIds.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              disabled={!canEditRestrictedFields}
                              onClick={() => setFormData({
                                ...formData,
                                staffUserIds: on ? formData.staffUserIds.filter((x) => x !== u.id) : [...formData.staffUserIds, u.id],
                              })}
                              style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", border: "none", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgb(var(--indigo-500-rgb) / 0.06)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                            >
                              <span style={{ fontWeight: 700 }}>{u.name || "—"} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {u.studentId || u.role}</span></span>
                              <span style={{ fontSize: 12, fontWeight: 900, color: on ? "var(--indigo-500)" : "var(--accent-primary)" }}>{on ? "✓ Added" : "+ Add"}</span>
                            </button>
                          );
                        })}
                      {assigneeUsers.length === 0 && (
                        <p style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>{lang === "th" ? "กำลังโหลดรายชื่อ…" : "Loading people…"}</p>
                      )}
                    </div>
                  )}
                  {formData.staffUserIds.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 10 }}>
                      {lang === "th" ? "ยังไม่ได้กำหนดทีมงาน" : "No one assigned as staff yet."}
                    </p>
                  )}
                </div>
  );
}
