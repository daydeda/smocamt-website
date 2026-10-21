"use client";

import { Users, CheckCircle2 } from "lucide-react";
import { ALL_PARTICIPANT_ROLES, type ParticipantRole, ROLE_LABELS } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function RoleAccessField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, formData, lang, setFormData, t } = ctx;
  return (
    <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามบทบาท)" : "Role-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกบทบาทที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกบทบาท"
                      : "Select which roles can see & join this event. Leave all unchecked = visible to everyone."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_PARTICIPANT_ROLES.map((role) => {
                      const isSelected = formData.allowedRoles.includes(role);
                      const roleColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
                        student: {
                          bg: isSelected ? "rgb(var(--indigo-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--indigo-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--indigo-500)" : "var(--text-secondary)",
                          badge: "var(--indigo-500)",
                        },
                        staff: {
                          bg: isSelected ? "rgb(var(--teal-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--teal-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--teal-500)" : "var(--text-secondary)",
                          badge: "var(--teal-500)",
                        },
                        smo: {
                          bg: isSelected ? "rgb(var(--violet-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--violet-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--violet-500)" : "var(--text-secondary)",
                          badge: "var(--violet-500)",
                        },
                        anusmo: {
                          bg: isSelected ? "rgb(var(--pink-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--pink-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--pink-500)" : "var(--text-secondary)",
                          badge: "var(--pink-500)",
                        },
                        club_president: {
                          bg: isSelected ? "rgb(var(--amber-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--amber-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--amber-500)" : "var(--text-secondary)",
                          badge: "var(--amber-500)",
                        },
                        major_president: {
                          bg: isSelected ? "rgb(var(--cyan-500-rgb) / 0.12)" : "var(--bg-elevated)",
                          border: isSelected ? "rgb(var(--cyan-500-rgb) / 0.5)" : "transparent",
                          text: isSelected ? "var(--cyan-500)" : "var(--text-secondary)",
                          badge: "var(--cyan-500)",
                        },
                      };
                      const c = roleColors[role];
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.allowedRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, allowedRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? c.badge : "transparent",
                            border: `2px solid ${isSelected ? c.badge : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: c.text }}>
                            {ROLE_LABELS[role as ParticipantRole]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Summary tag */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 800,
                      background: formData.allowedRoles.length === 0
                        ? "rgb(var(--emerald-500-rgb) / 0.1)"
                        : "rgb(var(--indigo-500-rgb) / 0.1)",
                      color: formData.allowedRoles.length === 0 ? "var(--emerald-500)" : "var(--indigo-500)",
                      border: `1px solid ${formData.allowedRoles.length === 0 ? "rgb(var(--emerald-500-rgb) / 0.2)" : "rgb(var(--indigo-500-rgb) / 0.2)"}`,
                    }}>
                      {formData.allowedRoles.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกบทบาท" : "✓ Open to all roles")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>
                </div>
  );
}
