"use client";

import { CheckCircle2, Building2 } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function ClubAccessField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, clubs, formData, lang, setFormData, t } = ctx;
  return (
    <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Building2 size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามชมรม)" : "Club-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "จำกัดให้เฉพาะสมาชิกชมรมที่เลือกเท่านั้นที่เห็น/เข้าร่วมกิจกรรมนี้ได้ หากไม่เลือก = ไม่จำกัดตามชมรม"
                      : "Restrict this event to members of the selected club(s) (add members under Admin > Clubs). Leave unchecked = no club restriction."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  {clubs.filter((c) => !c.isArchived).length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                      {lang === "th" ? "ยังไม่มีชมรม — สร้างได้ที่ Admin > Clubs" : "No clubs yet — create one under Admin > Clubs."}
                    </p>
                  ) : (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {clubs.filter((c) => !c.isArchived).map((club) => {
                        const isSelected = formData.allowedClubs.includes(club.id);
                        return (
                          <div
                            key={club.id}
                            onClick={() => {
                              const current = formData.allowedClubs;
                              const next = isSelected
                                ? current.filter((id) => id !== club.id)
                                : [...current, club.id];
                              setFormData({ ...formData, allowedClubs: next });
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 16px",
                              borderRadius: 14,
                              background: isSelected ? "rgb(var(--violet-500-rgb) / 0.12)" : "var(--bg-elevated)",
                              border: `1px solid ${isSelected ? "rgb(var(--violet-500-rgb) / 0.5)" : "transparent"}`,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              minWidth: 80,
                            }}
                          >
                            <div style={{
                              width: 20,
                              height: 20,
                              borderRadius: 6,
                              background: isSelected ? "var(--violet-500)" : "transparent",
                              border: `2px solid ${isSelected ? "var(--violet-500)" : "var(--border-medium)"}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              transition: "all 0.15s",
                            }}>
                              {isSelected && <CheckCircle2 size={13} color="white" />}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? "var(--violet-500)" : "var(--text-secondary)" }}>
                              {club.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
                      background: formData.allowedClubs.length === 0
                        ? "rgb(var(--emerald-500-rgb) / 0.1)"
                        : "rgb(var(--violet-500-rgb) / 0.1)",
                      color: formData.allowedClubs.length === 0 ? "var(--emerald-500)" : "var(--violet-500)",
                      border: `1px solid ${formData.allowedClubs.length === 0 ? "rgb(var(--emerald-500-rgb) / 0.2)" : "rgb(var(--violet-500-rgb) / 0.2)"}`,
                    }}>
                      {formData.allowedClubs.length === 0
                        ? (lang === "th" ? "✓ ไม่จำกัดตามชมรม" : "✓ No club restriction")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะสมาชิก: " : "Restricted to members of: "}${clubs.filter((c) => formData.allowedClubs.includes(c.id)).map((c) => c.name).join(", ")}`}
                    </div>
                  </div>
                </div>
  );
}
