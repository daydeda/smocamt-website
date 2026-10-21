"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { alpha } from "@/lib/ui/color";
import { type ParticipantRole, ROLE_LABELS, ALL_MAJORS } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function ManagedByField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, clubs, formData, lang, setFormData, t } = ctx;
  return (
    <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "ผู้ดูแลกิจกรรม (ประธาน)" : "Managed By (President)"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกประธานที่ดูแลกิจกรรมนี้ (เห็นในรายการ ดูการเช็คอิน สแกน ส่งออก) — ไม่กระทบสิทธิ์การเข้าร่วมของนักศึกษา"
                      : "Choose which president(s) manage this event (view it, see attendance, scan, export). Does NOT affect which students can join."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {(["club_president", "major_president"] as const).map((role) => {
                      const isSelected = formData.managedByRoles.includes(role);
                      const accent = role === "club_president" ? "var(--amber-500)" : "var(--cyan-500)";
                      return (
                        <div
                          key={role}
                          onClick={() => {
                            const current = formData.managedByRoles;
                            const next = current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current, role];
                            setFormData({ ...formData, managedByRoles: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: isSelected ? alpha(accent, 0.12) : "var(--bg-elevated)",
                            border: `1px solid ${isSelected ? alpha(accent, 0.5) : "transparent"}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 100,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? accent : "transparent",
                            border: `2px solid ${isSelected ? accent : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? accent : "var(--text-secondary)" }}>
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
                      background: formData.managedByRoles.length === 0
                        ? "rgb(var(--slate-400-rgb) / 0.12)"
                        : "rgb(var(--indigo-500-rgb) / 0.1)",
                      color: formData.managedByRoles.length === 0 ? "var(--text-muted)" : "var(--indigo-500)",
                      border: `1px solid ${formData.managedByRoles.length === 0 ? "var(--border-subtle)" : "rgb(var(--indigo-500-rgb) / 0.2)"}`,
                    }}>
                      {formData.managedByRoles.length === 0
                        ? (lang === "th" ? "จัดการโดยทีมงานเท่านั้น" : "Staff-managed only")
                        : `✓ ${lang === "th" ? "ดูแลโดย: " : "Managed by: "}${formData.managedByRoles.map(r => ROLE_LABELS[r as ParticipantRole] || r).join(", ")}`}
                    </div>
                  </div>

                  {/* Owner club(s)/major(s) — WHICH club_president/major_president may
                      actually manage this event (see EventScopeService). Without an
                      owner assigned here, the event stays hidden from every president
                      even though managedByRoles marks it as president-managed. */}
                  {formData.managedByRoles.includes("club_president") && (
                    <div style={{ marginTop: 14 }}>
                      <label className="label" style={{ fontSize: 12 }}>
                        {lang === "th" ? "ชมรมที่เป็นเจ้าของกิจกรรม" : "Owning club(s)"}
                      </label>
                      {clubs.filter((c) => !c.isArchived).length === 0 ? (
                        <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                          {lang === "th" ? "ยังไม่มีชมรม — สร้างได้ที่ Admin > Clubs" : "No clubs yet — create one under Admin > Clubs."}
                        </p>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                          {clubs.filter((c) => !c.isArchived).map((club) => {
                            const isSelected = formData.ownerClubIds.includes(club.id);
                            return (
                              <div
                                key={club.id}
                                onClick={() => {
                                  const current = formData.ownerClubIds;
                                  const next = isSelected
                                    ? current.filter((id) => id !== club.id)
                                    : [...current, club.id];
                                  setFormData({ ...formData, ownerClubIds: next });
                                }}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 10,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  background: isSelected ? "rgb(var(--amber-500-rgb) / 0.15)" : "var(--bg-elevated)",
                                  color: isSelected ? "var(--amber-500)" : "var(--text-secondary)",
                                  border: `1px solid ${isSelected ? "rgb(var(--amber-500-rgb) / 0.4)" : "var(--border-subtle)"}`,
                                }}
                              >
                                {club.name}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {formData.ownerClubIds.length === 0 && (
                        <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginTop: 6 }}>
                          {lang === "th"
                            ? "⚠ ยังไม่ได้กำหนดชมรม — จะไม่แสดงกับประธานชมรมคนใดจนกว่าจะเลือก"
                            : "⚠ No club assigned yet — hidden from every club president until you pick one."}
                        </p>
                      )}
                    </div>
                  )}
                  {formData.managedByRoles.includes("major_president") && (
                    <div style={{ marginTop: 14 }}>
                      <label className="label" style={{ fontSize: 12 }}>
                        {lang === "th" ? "สาขาที่เป็นเจ้าของกิจกรรม" : "Owning major(s)"}
                      </label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                        {ALL_MAJORS.map((major) => {
                          const isSelected = formData.ownerMajors.includes(major);
                          return (
                            <div
                              key={major}
                              onClick={() => {
                                const current = formData.ownerMajors;
                                const next = isSelected
                                  ? current.filter((m) => m !== major)
                                  : [...current, major];
                                setFormData({ ...formData, ownerMajors: next });
                              }}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 10,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                background: isSelected ? "rgb(var(--cyan-500-rgb) / 0.15)" : "var(--bg-elevated)",
                                color: isSelected ? "var(--cyan-500)" : "var(--text-secondary)",
                                border: `1px solid ${isSelected ? "rgb(var(--cyan-500-rgb) / 0.4)" : "var(--border-subtle)"}`,
                              }}
                            >
                              {major}
                            </div>
                          );
                        })}
                      </div>
                      {formData.ownerMajors.length === 0 && (
                        <p style={{ fontSize: 11, color: "var(--cyan-500)", fontWeight: 700, marginTop: 6 }}>
                          {lang === "th"
                            ? "⚠ ยังไม่ได้กำหนดสาขา — จะไม่แสดงกับประธานสาขาคนใดจนกว่าจะเลือก"
                            : "⚠ No major assigned yet — hidden from every major president until you pick one."}
                        </p>
                      )}
                    </div>
                  )}
                </div>
  );
}
