"use client";

import { CheckCircle2, DoorOpen } from "lucide-react";
import type { AdminEventsPageCtx } from "../../_lib/useAdminEventsPage";

export function WalkInsFields({ ctx }: { ctx: AdminEventsPageCtx }) {
  const { formData, setFormData, t } = ctx;
  return (
    <div className="field" style={{ marginTop: 20 }}>
                  <div
                    onClick={() => {
                      const nextVal = !formData.walkInsOnly;
                      setFormData({
                        ...formData,
                        walkInsOnly: nextVal,
                        ...(nextVal && { walkInsEnabled: true }),
                      });
                    }}
                    style={{
                      minHeight: 48,
                      background: "var(--bg-elevated)",
                      borderRadius: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      cursor: "pointer",
                      border: formData.walkInsOnly ? "1px solid var(--accent-primary)" : "1px solid transparent",
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, flexShrink: 0, borderRadius: 6,
                      border: "2px solid var(--border-medium)",
                      background: formData.walkInsOnly ? "var(--accent-primary)" : "transparent",
                      borderColor: formData.walkInsOnly ? "var(--accent-primary)" : "var(--border-medium)",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s"
                    }}>
                      {formData.walkInsOnly && <CheckCircle2 size={16} color="white" />}
                    </div>
                    <DoorOpen size={18} style={{ flexShrink: 0, color: formData.walkInsOnly ? "var(--accent-primary)" : "var(--text-muted)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: formData.walkInsOnly ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {t.walkInsOnlyToggleLabel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {t.walkInsOnlyToggleHint}
                      </span>
                    </div>
                  </div>
                </div>
  );
}
