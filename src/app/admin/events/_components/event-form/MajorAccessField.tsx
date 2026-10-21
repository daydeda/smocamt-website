"use client";

import { Users, CheckCircle2 } from "lucide-react";
import { ALL_MAJORS, MAJOR_LABELS } from "../../_lib/event-model";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function MajorAccessField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { canEditRestrictedFields, formData, lang, setFormData, t } = ctx;
  return (
    <div className="field" style={{ marginBottom: 0, opacity: canEditRestrictedFields ? 1 : 0.5, pointerEvents: canEditRestrictedFields ? "auto" : "none" }}>
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} style={{ color: "var(--accent-primary)" }} />
                    {lang === "th" ? "สิทธิ์การเข้าร่วม (ตามสาขา)" : "Major-Based Access Control"}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                    {lang === "th"
                      ? "เลือกสาขาที่อนุญาตให้เข้าร่วมกิจกรรมนี้ หากไม่เลือก = ทุกสาขา"
                      : "Select which majors can see & join this event. Leave all unchecked = open to every major."}
                  </p>
                  {!canEditRestrictedFields && (
                    <p style={{ fontSize: 11, color: "var(--amber-500)", fontWeight: 700, marginBottom: 10 }}>{t.eventStaffOnlyFieldHint}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {ALL_MAJORS.map((major) => {
                      const isSelected = formData.allowedMajors.includes(major);
                      return (
                        <div
                          key={major}
                          onClick={() => {
                            const current = formData.allowedMajors;
                            const next = current.includes(major)
                              ? current.filter((m) => m !== major)
                              : [...current, major];
                            setFormData({ ...formData, allowedMajors: next });
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 16px",
                            borderRadius: 14,
                            background: isSelected ? "rgb(var(--accent-rgb) / 0.12)" : "var(--bg-elevated)",
                            border: `1px solid ${isSelected ? "rgb(var(--accent-rgb) / 0.5)" : "transparent"}`,
                            cursor: "pointer",
                            transition: "all 0.2s",
                            minWidth: 80,
                          }}
                        >
                          <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: isSelected ? "var(--accent-primary)" : "transparent",
                            border: `2px solid ${isSelected ? "var(--accent-primary)" : "var(--border-medium)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {isSelected && <CheckCircle2 size={13} color="white" />}
                          </div>
                          <span
                            title={MAJOR_LABELS[major]}
                            style={{ fontSize: 13, fontWeight: 800, color: isSelected ? "var(--accent-primary)" : "var(--text-secondary)" }}
                          >
                            {major}
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
                      background: formData.allowedMajors.length === 0
                        ? "rgb(var(--emerald-500-rgb) / 0.1)"
                        : "rgb(var(--accent-rgb) / 0.1)",
                      color: formData.allowedMajors.length === 0 ? "var(--emerald-500)" : "var(--accent-primary)",
                      border: `1px solid ${formData.allowedMajors.length === 0 ? "rgb(var(--emerald-500-rgb) / 0.2)" : "rgb(var(--accent-rgb) / 0.2)"}`,
                    }}>
                      {formData.allowedMajors.length === 0
                        ? (lang === "th" ? "✓ เปิดให้ทุกสาขา" : "✓ Open to all majors")
                        : `✓ ${lang === "th" ? "จำกัดเฉพาะ: " : "Restricted to: "}${formData.allowedMajors.join(", ")}`}
                    </div>
                  </div>
                </div>
  );
}
