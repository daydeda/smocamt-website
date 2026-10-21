"use client";

import { GraduationCap } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function YearEligibilityField({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, setFormData, t } = ctx;
  return (
    <fieldset className="field" style={{ marginTop: 20, padding: 0, border: 0 }}>
                  <legend className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <GraduationCap size={18} style={{ color: "var(--accent-primary)" }} />
                    {t.allowedStudentYears}
                  </legend>
                  <p id="allowed-years-hint" style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4, margin: "4px 0 12px" }}>
                    {t.allowedStudentYearsHint}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {[1, 2, 3, 4].map((year) => {
                      const selected = formData.allowedYears.includes(year);
                      return (
                        <label key={year} style={{
                          minHeight: 48, background: "var(--bg-elevated)", borderRadius: 16,
                          display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                          cursor: "pointer", border: `1px solid ${selected ? "var(--accent-primary)" : "transparent"}`,
                          color: selected ? "var(--text-primary)" : "var(--text-secondary)", fontSize: 14, fontWeight: 700,
                        }}>
                          <input
                            type="checkbox"
                            checked={selected}
                            aria-describedby="allowed-years-hint"
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setFormData((prev) => ({
                                ...prev,
                                allowedYears: checked
                                  ? [...prev.allowedYears, year].sort((a, b) => a - b)
                                  : prev.allowedYears.filter((value) => value !== year),
                              }));
                            }}
                            style={{ width: 20, height: 20, flexShrink: 0, accentColor: "var(--accent-primary)" }}
                          />
                          {t.studentYearLabel.replace("{year}", String(year))}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
  );
}
